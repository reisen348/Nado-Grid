import type { AuditEvent } from "../../../../packages/shared/src/index.ts";
import type { StrategyStore } from "../store/types.ts";

export async function writeAudit(
  store: StrategyStore,
  event: Omit<AuditEvent, "id" | "createdAt">
): Promise<AuditEvent> {
  const audit: AuditEvent = {
    ...event,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  await store.addAudit(audit);
  return audit;
}
