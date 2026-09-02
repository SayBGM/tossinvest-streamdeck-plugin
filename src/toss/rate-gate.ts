export interface RateGateOptions {
  readonly now?: () => number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export class RateGate {
  private readonly now: () => number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private tail = Promise.resolve();
  private nextAt = 0;

  constructor(private readonly intervalMs: number, options: RateGateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.tail.then(async () => {
      const waitMs = Math.max(0, this.nextAt - this.now());
      if (waitMs > 0) await this.delay(waitMs);
      this.nextAt = this.now() + this.intervalMs;
      return operation();
    });
    this.tail = queued.then(() => undefined, () => undefined);
    return queued;
  }
}
