const DEFAULT_DEBOUNCE_MS = 200;

export function chunkSymbols(
  symbols: readonly string[],
  size = 200,
): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < symbols.length; start += size) {
    chunks.push(symbols.slice(start, start + size));
  }
  return chunks;
}

/** Owns debounce waiters and per-symbol refresh de-duplication. */
export class RefreshCoordinator {
  private waiters: Array<() => void> = [];
  private debounce?: ReturnType<typeof setTimeout>;
  private batchInFlight?: Promise<void>;
  private readonly symbolInFlight = new Map<
    string,
    { promise: Promise<void>; version: number | undefined }
  >();

  requestBatch(run: () => Promise<void>, destroyed: () => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      if (this.debounce || this.batchInFlight) return;
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        const waiters = this.takeWaiters();
        if (destroyed()) {
          for (const waiter of waiters) waiter();
          return;
        }
        const operation = run().catch(() => undefined).finally(() => {
          this.batchInFlight = undefined;
          for (const waiter of waiters) waiter();
          if (this.waiters.length > 0) this.requestBatch(run, destroyed);
        });
        this.batchInFlight = operation;
      }, DEFAULT_DEBOUNCE_MS);
    });
  }

  async requestSymbol(
    symbol: string,
    currentVersion: () => number | undefined,
    run: () => Promise<void>,
    destroyed: () => boolean,
  ): Promise<void> {
    while (!destroyed()) {
      const wantedVersion = currentVersion();
      const current = this.symbolInFlight.get(symbol);
      if (current) {
        await current.promise;
        if (currentVersion() !== current.version) continue;
        return;
      }
      const entry = { version: wantedVersion, promise: Promise.resolve() };
      entry.promise = run().finally(() => {
        if (this.symbolInFlight.get(symbol) === entry) this.symbolInFlight.delete(symbol);
      });
      this.symbolInFlight.set(symbol, entry);
      await entry.promise;
      if (currentVersion() === wantedVersion) return;
    }
  }

  destroy(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    for (const waiter of this.takeWaiters()) waiter();
  }

  private takeWaiters(): Array<() => void> {
    const waiters = this.waiters;
    this.waiters = [];
    return waiters;
  }
}
