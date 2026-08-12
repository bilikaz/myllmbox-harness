// The Database plugin — a main-process ConnectionPlugin owning live connection pools keyed by connection
// name (engine-agnostic OpenConn handles; the driver owns the native pool). `resolve()` is the ONE place a
// pool is opened (reuse the live one, else establish from the saved/supplied password + validate, else
// throw). Its tools (query/test/connections) are registered from registerTools() with `this` injected, so
// they reach live state directly. Engine specifics live in drivers/ (picked by connection.engine); this
// file never imports a DB library. Ephemeral process state; a supplied password is transient, never persisted.

import { ConnectionPlugin } from "../../core/plugins/base.ts";
import type { DbConnection } from "./types.ts";
import type { OpenConn, QueryResult } from "./drivers/types.ts";
import { drivers } from "./drivers/index.ts";
import { DatabaseQuery } from "./tools/local/query.ts";
import { DatabaseTestConnection } from "./tools/local/test.ts";
import { DatabaseConnections } from "./tools/local/connections.ts";

export type { QueryResult };

export class DbPlugin extends ConnectionPlugin<OpenConn> {
  protected override registerTools(): void {
    this.registry.register(DatabaseQuery.schema.function.name, (c, ct) => new DatabaseQuery(c, ct, this), this.slug);
    this.registry.register(DatabaseTestConnection.schema.function.name, (c, ct) => new DatabaseTestConnection(c, ct, this), this.slug);
    this.registry.register(DatabaseConnections.schema.function.name, (c, ct) => new DatabaseConnections(c, ct, this), this.slug);
  }

  protected closeHandle(_name: string, conn: OpenConn): Promise<void> {
    return conn.end().catch(() => undefined);
  }

  // The ONE place a connection is resolved. Reuse the live pool, or establish a new one (via the engine's
  // driver) and VALIDATE it with probe() — so every failure mode surfaces here with its own message. Passing
  // a password forces a fresh pool. Throws on failure; the bad pool is torn down so a failed attempt never
  // lingers.
  private async resolve(c: DbConnection, password?: string): Promise<OpenConn> {
    const live = this.live.get(c.name);
    if (live && password === undefined) return live;
    const pw = password ?? c.password;
    if (!pw) throw new Error(`connection "${c.name}" has no saved password — open the Database panel and connect manually`);
    if (live) await this.disconnect(c.name);
    const conn = await drivers[c.engine].open(c, pw);
    try {
      await conn.probe(); // the actual connect — throws ECONNREFUSED / access-denied / etc.
    } catch (e) {
      await conn.end().catch(() => undefined);
      throw e;
    }
    this.live.set(c.name, conn);
    this.notifyConnections();
    return conn;
  }

  isConnected(name: string): boolean {
    return this.live.has(name);
  }

  // Establish (or re-establish) — resolve() validates it, so a forced reconnect surfaces any failure.
  async connect(c: DbConnection, password?: string): Promise<void> {
    await this.resolve(c, password);
  }

  // Liveness check (the test tool) — resolve then probe again, so a live-but-dead pool is also caught.
  async ping(c: DbConnection): Promise<void> {
    await (await this.resolve(c)).probe();
  }

  async query(c: DbConnection, sql: string): Promise<QueryResult> {
    return (await this.resolve(c)).query(sql);
  }

  // UI-invokable surface (not agent tools). connect takes the connection def + a transient password.
  readonly rpc = {
    connect: (c: DbConnection, password?: string) => this.connect(c, password),
    disconnect: (name: string) => this.disconnect(name),
    status: () => this.status(),
  };
}
