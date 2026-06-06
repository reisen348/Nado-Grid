import type { AuditEvent, StrategyRecord } from "../../../../packages/shared/src/index.ts";

export interface StrategyStore {
  upsertStrategy(strategy: StrategyRecord): Promise<void>;
  getStrategy(id: string): Promise<StrategyRecord | undefined>;
  listStrategies(): Promise<StrategyRecord[]>;
  addAudit(event: AuditEvent): Promise<void>;
  listAudit(strategyId?: string, limit?: number): Promise<AuditEvent[]>;
  reserveWebhookNonce(strategyId: string, nonce: string): Promise<boolean>;
  close(): Promise<void>;
}
