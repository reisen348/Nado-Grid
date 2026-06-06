import type { AuditEvent, StrategyRecord } from "../../../../packages/shared/src/index.ts";
import type { StrategyStore } from "./types.ts";

export class MemoryStrategyStore implements StrategyStore {
  private readonly strategies = new Map<string, StrategyRecord>();
  private readonly audit: AuditEvent[] = [];
  private readonly nonces = new Set<string>();

  async upsertStrategy(strategy: StrategyRecord): Promise<void> {
    this.strategies.set(strategy.id, structuredClone(strategy));
  }

  async getStrategy(id: string): Promise<StrategyRecord | undefined> {
    const strategy = this.strategies.get(id);
    return strategy ? structuredClone(strategy) : undefined;
  }

  async listStrategies(): Promise<StrategyRecord[]> {
    return [...this.strategies.values()]
      .map((strategy) => structuredClone(strategy))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async addAudit(event: AuditEvent): Promise<void> {
    this.audit.push(structuredClone(event));
  }

  async listAudit(strategyId?: string, limit = 100): Promise<AuditEvent[]> {
    return this.audit
      .filter((event) => !strategyId || event.strategyId === strategyId)
      .slice(-limit)
      .reverse()
      .map((event) => structuredClone(event));
  }

  async reserveWebhookNonce(strategyId: string, nonce: string): Promise<boolean> {
    const key = `${strategyId}:${nonce}`;
    if (this.nonces.has(key)) return false;
    this.nonces.add(key);
    return true;
  }

  async close(): Promise<void> {
    this.strategies.clear();
    this.audit.length = 0;
    this.nonces.clear();
  }
}
