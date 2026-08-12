// The MCP plugin — a main-process ConnectionPlugin owning the live MCP clients keyed by RAW server name. On
// connect it discovers a server's tools (tools/list) and REGISTERS one McpTool per tool into the tool
// registry (its constructor dep); on disconnect it unregisters them and closes the client. The agent's tool
// set is the union of connected servers' tools. Connections open on demand (panel / Refresh), never eagerly.
// Secrets: saved env/headers ride config; a transient override may be supplied at connect and is never persisted.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { ConnectionPlugin } from "../../core/plugins/base.ts";
import type { ToolResult, ToolSpec, Image } from "../../core/tools/types.ts";
import { cap } from "../../core/tools/base.ts";
import { errorMessage } from "../../lib/errors.ts";
import { McpTool, type McpToolDescriptor } from "./tool.ts";
import { mcpToolName, type McpServer } from "./types.ts";
import { stdioTransport } from "./transports/stdio.ts";
import { httpTransport } from "./transports/http.ts";
import { McpOAuthProvider, authorizeInWindow } from "./oauth.ts";

export interface McpSecretOverride {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  oauthClientSecret?: string;
}

interface Live {
  client: Client;
  tools: string[]; // ORIGINAL MCP tool names (the toolDefaults keys); prefixed names derive via mcpToolName
}

// Plain transport (no OAuth): manual headers for http, subprocess for stdio. The OAuth path is its own dance
// in openConnectedClient(), since it spans a browser round-trip.
function transportFor(server: McpServer, override?: McpSecretOverride): Transport {
  if (server.transport === "http") return httpTransport(server, { ...server.headers, ...override?.headers });
  return stdioTransport(server, override?.env);
}

async function newConnectedClient(transport: Transport): Promise<Client> {
  const client = new Client({ name: "myllmbox-harness", version: "0.1.0" });
  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    await client.close().catch(() => undefined);
    throw e;
  }
}

// MCP content blocks → ToolResult: join text, surface images as data URLs, isError → ok:false.
function mapResult(res: { content?: unknown; isError?: boolean; toolResult?: unknown }): ToolResult {
  const blocks = Array.isArray(res.content) ? (res.content as Array<Record<string, unknown>>) : [];
  const texts: string[] = [];
  const images: Image[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "image" && typeof b.data === "string") images.push({ url: `data:${typeof b.mimeType === "string" ? b.mimeType : "image/png"};base64,${b.data}`, mime: typeof b.mimeType === "string" ? b.mimeType : undefined });
    else texts.push(JSON.stringify(b));
  }
  const text = texts.join("\n").trim();
  const result: ToolResult = { ok: res.isError !== true, output: cap(text || (images.length ? "[image content]" : "(no content)")) };
  if (images.length) result.images = images;
  return result;
}

async function callTool(client: Client, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  try {
    const res = await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { signal });
    return mapResult(res);
  } catch (e) {
    return { ok: false, output: `MCP tool "${tool}" failed: ${errorMessage(e)}` };
  }
}

export class McpPlugin extends ConnectionPlugin<Live> {
  // Bring up a client, handling the OAuth browser dance. Drives auth() PROACTIVELY (some servers surface a
  // 401 as a plain HTTP error before the transport's lazy auth fires). Self-heal: a silently-authorized
  // connect that fails (removed/revoked token) clears creds and re-consents. At most one window.
  private async openConnectedClient(server: McpServer, override?: McpSecretOverride): Promise<Client> {
    if (server.transport !== "http" || (server.auth !== "oauth" && server.auth !== "oauthApp")) {
      return newConnectedClient(transportFor(server, override));
    }
    const isApp = server.auth === "oauthApp"; // registered-app → supply client id/secret; DCR → none
    const provider = new McpOAuthProvider(server.name, {
      clientId: isApp ? server.oauth?.clientId : undefined,
      clientSecret: isApp ? (override?.oauthClientSecret ?? server.oauth?.clientSecret) : undefined,
      scopes: server.oauth?.scopes,
    });
    const opts = { serverUrl: server.url, scope: server.oauth?.scopes };

    let result = await auth(provider, opts);
    if (result === "AUTHORIZED") {
      try {
        return await newConnectedClient(httpTransport(server, undefined, provider));
      } catch {
        provider.invalidateCredentials("all");
        result = await auth(provider, opts); // no token now → REDIRECT
      }
    }
    if (result === "REDIRECT") {
      if (!provider.authorizeUrl) throw new Error("OAuth flow did not produce an authorization URL");
      this.emit("authorizing", server.name); // consent window open
      const code = await authorizeInWindow(provider.authorizeUrl, (s) => s === provider.expectedState());
      await auth(provider, { ...opts, authorizationCode: code });
    }
    return newConnectedClient(httpTransport(server, undefined, provider));
  }

  // Connect (or re-fire): drop any prior registration, open the client, discover tools, register each.
  private async connect(server: McpServer, override?: McpSecretOverride): Promise<void> {
    await this.disconnect(server.name);
    const client = await this.openConnectedClient(server, override);
    const names: string[] = [];
    try {
      // Discovery + registration AFTER a live connection — if either throws, unwind (unregister partial
      // tools, close the client) or it leaks unreachable.
      const { tools } = await client.listTools();
      for (const t of tools) {
        const schema: ToolSpec = {
          type: "function",
          function: { name: mcpToolName(server.name, t.name), description: t.description ?? "", parameters: t.inputSchema ?? { type: "object" } },
        };
        const desc: McpToolDescriptor = { server: server.name, tool: t.name, schema, call: (args, signal) => callTool(client, t.name, args, signal) };
        this.registry.register(desc.schema.function.name, (config, container) => new McpTool(config, container, desc), this.slug);
        names.push(t.name);
      }
    } catch (e) {
      for (const t of names) this.registry.unregister(mcpToolName(server.name, t));
      await client.close().catch(() => undefined);
      throw e;
    }
    this.live.set(server.name, { client, tools: names });
    this.notifyConnections();
  }

  protected closeHandle(name: string, l: Live): Promise<void> {
    for (const t of l.tools) this.registry.unregister(mcpToolName(name, t));
    return l.client.close().catch(() => undefined);
  }

  // UI-invokable surface (not agent tools).
  readonly rpc = {
    connect: (server: McpServer, override?: McpSecretOverride) => this.connect(server, override),
    disconnect: (name: string) => this.disconnect(name),
    refresh: (server: McpServer, override?: McpSecretOverride) => this.connect(server, override),
    status: () => this.status(),
    tools: (name: string) => this.live.get(name)?.tools ?? [], // ORIGINAL tool names of a connected server
  };
}
