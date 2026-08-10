// createClient/call contract — the handler's return IS the result (no envelope); HealError re-prompts with the bad answer + correction until valid or the budget is spent, anything else propagates untouched.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, HealError, jsonHandler, bufferEvents, type ResponseHandler } from "../src/llm/index.ts";
import type { CallTarget } from "../src/llm/types.ts";

const CFG: CallTarget = { provider: { name: "m", type: "openai", baseUrl: "http://llm:8000/v1" }, model: { id: "x" } };
const IMG: CallTarget = { provider: { name: "Img", type: "openai", baseUrl: "http://b" }, model: {} };

const client = createClient({
  resolve(service) {
    if (service === "text") return CFG;
    if (service === "image") return IMG;
    return null;
  },
});

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("client.call", () => {
  it("returns the trimmed text with the provider's default handler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("  hello  ")));
    expect(await client.call({ service: "text", messages: [{ role: "user", content: "hi" }] })).toBe("hello");
  });

  it("throws on an unassigned service without firing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.call({ service: "video", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/no model is assigned/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns whatever the caller's handler returns — including side-effect shapes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("saved")));
    const sink: string[] = [];
    const myBelovedHandler: ResponseHandler<boolean> = {
      async handle(interaction) {
        if (interaction.kind !== "chat") throw new Error("expected chat");
        sink.push((await bufferEvents(interaction.events)).text);
        return true;
      },
    };
    expect(await client.call({ service: "text", messages: [{ role: "user", content: "hi" }], handler: myBelovedHandler })).toBe(true);
    expect(sink).toEqual(["saved"]);
  });

  it("heals on HealError: re-prompts with the bad answer + correction, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sse("not-json")).mockResolvedValueOnce(sse('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const obj = await client.call({
      service: "text",
      messages: [{ role: "user", content: "give json" }],
      handler: jsonHandler((t) => JSON.parse(t) as { a: number }),
    });
    expect(obj).toEqual({ a: 1 });

    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("not-json");
    expect(body.messages[2].content).toContain("Validation error");
  });

  it("rethrows the HealError once the budget is spent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("never-json")));
    await expect(
      client.call({ service: "text", messages: [{ role: "user", content: "json" }], handler: jsonHandler(JSON.parse), maxHeals: 1 }),
    ).rejects.toBeInstanceOf(HealError);
  });

  it("the provider supplies the default handler: an image target yields an image via /images/generations", async () => {
    const b64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: b64 }], output_format: "png" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await client.call<{ b64: string; mime: string }>({
      service: "image",
      messages: [{ role: "user", content: "a red square" }],
    });
    expect(out.mime).toBe("image/png");
    expect(out.b64).toBe(b64);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://b/images/generations");
    // No dimensions/seed given → only the constant knobs; the server's own defaults apply.
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "a red square", n: 1, response_format: "b64_json" });
  });

  it("refuses a service whose target type has no provider for its modality — non-healable, no request fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // An image service resolved to an anthropic target: media generation is OpenAI-only, so there is
    // no image/anthropic provider — the load step throws before any request fires.
    const c = createClient({ resolve: () => ({ provider: { name: "a", type: "anthropic", baseUrl: "http://a" }, model: {} }) });
    await expect(
      c.call({ service: "image", messages: [{ role: "user", content: "hi" }], handler: jsonHandler(JSON.parse) }),
    ).rejects.toThrow(/there is no image\/anthropic provider/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates transport failures untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400, statusText: "Bad Request" })));
    await expect(client.call({ service: "text", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/400/);
  });
});
