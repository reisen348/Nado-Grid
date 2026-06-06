import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, StrategyRecord } from "../../../../packages/shared/src/index.ts";
import type { StrategyStore } from "./types.ts";

export class SQLiteStrategyStore implements StrategyStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        strategy_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_nonces (
        strategy_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (strategy_id, nonce)
      );
    `);
  }

  async upsertStrategy(strategy: StrategyRecord): Promise<void> {
    this.db
      .prepare("INSERT INTO strategies (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
      .run(strategy.id, JSON.stringify(strategy), strategy.updatedAt);
  }

  async getStrategy(id: string): Promise<StrategyRecord | undefined> {
    const row = this.db.prepare("SELECT payload FROM strategies WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StrategyRecord) : undefined;
  }

  async listStrategies(): Promise<StrategyRecord[]> {
    const rows = this.db.prepare("SELECT payload FROM strategies ORDER BY updated_at DESC").all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as StrategyRecord);
  }

  async addAudit(event: AuditEvent): Promise<void> {
    this.db
      .prepare("INSERT INTO audit_events (id, strategy_id, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(event.id, event.strategyId ?? null, JSON.stringify(event), event.createdAt);
  }

  async listAudit(strategyId?: string, limit = 100): Promise<AuditEvent[]> {
    const rows = strategyId
      ? (this.db
          .prepare("SELECT payload FROM audit_events WHERE strategy_id = ? ORDER BY created_at DESC LIMIT ?")
          .all(strategyId, limit) as { payload: string }[])
      : (this.db.prepare("SELECT payload FROM audit_events ORDER BY created_at DESC LIMIT ?").all(limit) as { payload: string }[]);
    return rows.map((row) => JSON.parse(row.payload) as AuditEvent);
  }

  async reserveWebhookNonce(strategyId: string, nonce: string): Promise<boolean> {
    try {
      this.db
        .prepare("INSERT INTO webhook_nonces (strategy_id, nonce, created_at) VALUES (?, ?, ?)")
        .run(strategyId, nonce, new Date().toISOString());
      return true;
    } catch (error) {
      if (error instanceof Error && /constraint/i.test(error.message)) return false;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
