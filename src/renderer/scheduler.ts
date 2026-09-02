export type RenderPriority = "normal" | "immediate";

export interface RenderRequest {
  readonly priority: RenderPriority;
  readonly key: string;
  readonly render: () => string | Promise<string>;
  readonly commit: (image: string) => void | Promise<void>;
}

interface Target {
  readonly id: string;
  readonly generation: number;
  interval: number;
  pending?: RenderRequest;
  timer?: ReturnType<typeof setTimeout>;
  rendering: boolean;
  lastKey?: string;
  lastImage?: string;
}

interface QueueEntry { readonly target: Target; readonly request: RenderRequest; readonly image: string }

export class RenderScheduler {
  private readonly targets = new Map<string, Target>();
  private readonly queue = new Map<string, QueueEntry>();
  private targetOrder: string[] = [];
  private queueTimer?: ReturnType<typeof setTimeout>;
  private lastCommitAt = 0;
  private generation = 0;
  private destroyed = false;

  activate(id: string, interval: number): number {
    this.removeAny(id);
    const target = { id, generation: ++this.generation, interval, rendering: false };
    this.targets.set(id, target);
    this.targetOrder.push(id);
    return target.generation;
  }

  updateInterval(id: string, generation: number, interval: number): boolean {
    const target = this.get(id, generation);
    if (!target) return false;
    target.interval = interval;
    return true;
  }

  submit(id: string, generation: number, request: RenderRequest): boolean {
    const target = this.get(id, generation);
    if (!target || this.destroyed) return false;
    target.pending = request;
    if (request.priority === "immediate") {
      if (target.timer) clearTimeout(target.timer);
      target.timer = undefined;
      void this.flushTarget(target);
    } else if (!target.rendering && !target.timer) {
      target.timer = setTimeout(() => {
        target.timer = undefined;
        void this.flushTarget(target);
      }, Math.max(0, target.interval));
    }
    return true;
  }

  remove(id: string, generation: number): boolean {
    const target = this.get(id, generation);
    if (!target) return false;
    this.removeAny(id);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    for (const target of this.targets.values()) if (target.timer) clearTimeout(target.timer);
    this.targets.clear();
    this.queue.clear();
    this.targetOrder = [];
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = undefined;
  }

  private async flushTarget(target: Target): Promise<void> {
    if (target.rendering || this.destroyed || this.targets.get(target.id) !== target) return;
    const request = target.pending;
    target.pending = undefined;
    if (!request || request.key === target.lastKey) return;
    target.rendering = true;
    try {
      const image = await request.render();
      if (this.targets.get(target.id) !== target) return;
      this.queue.set(target.id, { target, request, image });
      this.drainQueue();
    } catch {
      // Rendering is observational; the next quote tick can retry it.
    } finally {
      target.rendering = false;
      const pending = target.pending as RenderRequest | undefined;
      if (pending && !target.timer && !this.destroyed) {
        target.timer = setTimeout(() => {
          target.timer = undefined;
          void this.flushTarget(target);
        }, pending.priority === "immediate" ? 0 : Math.max(0, target.interval));
      }
    }
  }

  private drainQueue(): void {
    if (this.queueTimer || this.destroyed || this.queue.size === 0) return;
    const wait = Math.max(0, this.lastCommitAt + 34 - Date.now());
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined;
      const entry = this.nextEntry();
      if (!entry) return;
      void Promise.resolve(entry.request.commit(entry.image)).finally(() => {
        if (this.targets.get(entry.target.id) === entry.target) {
          entry.target.lastKey = entry.request.key;
          entry.target.lastImage = entry.image;
        }
        this.lastCommitAt = Date.now();
        this.drainQueue();
      });
    }, wait);
  }

  private nextEntry(): QueueEntry | undefined {
    for (let i = 0; i < this.targetOrder.length; i += 1) {
      const index = i;
      const id = this.targetOrder[index];
      if (id === undefined) continue;
      const entry = this.queue.get(id);
      if (entry) {
        this.queue.delete(id);
        this.targetOrder = [...this.targetOrder.slice(index + 1), ...this.targetOrder.slice(0, index + 1)];
        return entry;
      }
    }
    const first = this.queue.keys().next().value as string | undefined;
    if (!first) return undefined;
    const entry = this.queue.get(first);
    this.queue.delete(first);
    return entry;
  }

  private get(id: string, generation: number): Target | undefined {
    const target = this.targets.get(id);
    return target && target.generation === generation ? target : undefined;
  }

  private removeAny(id: string): void {
    const target = this.targets.get(id);
    if (target?.timer) clearTimeout(target.timer);
    this.targets.delete(id);
    this.queue.delete(id);
    this.targetOrder = this.targetOrder.filter((entry) => entry !== id);
  }
}
