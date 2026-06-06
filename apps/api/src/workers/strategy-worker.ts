import type { StrategyService } from "../services/strategy-service.ts";

export class StrategyWorker {
  private timer: NodeJS.Timeout | undefined;
  private readonly service: StrategyService;
  private readonly intervalMs: number;

  constructor(
    service: StrategyService,
    intervalMs = 10_000
  ) {
    this.service = service;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.service.tickRunningStrategies().catch((error) => {
        console.error("strategy worker tick failed", error);
      });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
