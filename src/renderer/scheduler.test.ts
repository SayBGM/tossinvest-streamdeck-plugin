import { describe, expect, it, vi } from "vitest";
import { RenderScheduler } from "./scheduler.js";

describe("render scheduler", () => {
  it("coalesces pending frames and commits the newest frame", async () => {
    vi.useFakeTimers();
    const scheduler = new RenderScheduler();
    const commits: string[] = [];
    const generation = scheduler.activate("key", 100);
    scheduler.submit("key", generation, { priority: "normal", key: "one", render: () => "one", commit: (value) => { commits.push(value); } });
    scheduler.submit("key", generation, { priority: "normal", key: "two", render: () => "two", commit: (value) => { commits.push(value); } });
    await vi.advanceTimersByTimeAsync(101);
    await vi.advanceTimersByTimeAsync(101);
    expect(commits).toEqual(["two"]);
    vi.useRealTimers();
  });

  it("limits commits across every key to ten per second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const scheduler = new RenderScheduler();
    const commits: string[] = [];

    for (let index = 0; index < 12; index += 1) {
      const id = `key-${index}`;
      const generation = scheduler.activate(id, 0);
      scheduler.submit(id, generation, {
        priority: "normal",
        key: `frame-${index}`,
        render: () => `image-${index}`,
        commit: (value) => {
          commits.push(value);
        },
      });
    }

    await vi.advanceTimersByTimeAsync(999);
    expect(commits).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(201);
    expect(commits).toHaveLength(12);

    scheduler.destroy();
    vi.useRealTimers();
  });

  it("serializes async commits and waits before starting the next key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const scheduler = new RenderScheduler();
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = scheduler.activate("first", 0);
    const second = scheduler.activate("second", 0);
    scheduler.submit("first", first, { priority: "normal", key: "first", render: () => "first", commit: async () => { started.push("first"); await firstDone; } });
    scheduler.submit("second", second, { priority: "normal", key: "second", render: () => "second", commit: () => { started.push("second"); } });

    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(["first"]);
    releaseFirst();
    await Promise.resolve();
    expect(started).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toEqual(["first", "second"]);
    scheduler.destroy();
    vi.useRealTimers();
  });

  it("does not mark a synchronously failed commit as committed and retries it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const scheduler = new RenderScheduler();
    let attempts = 0;
    const generation = scheduler.activate("key", 0);
    scheduler.submit("key", generation, {
      priority: "normal",
      key: "same-frame",
      render: () => "image",
      commit: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("commit failed");
      },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(2);
    scheduler.destroy();
    vi.useRealTimers();
  });

  it("ignores a late commit completion after target replacement", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = new RenderScheduler();
    const oldGeneration = scheduler.activate("key", 0);
    scheduler.submit("key", oldGeneration, { priority: "normal", key: "old", render: () => "old", commit: () => done });
    await vi.advanceTimersByTimeAsync(1);
    scheduler.remove("key", oldGeneration);
    const newGeneration = scheduler.activate("key", 0);
    const commits: string[] = [];
    scheduler.submit("key", newGeneration, { priority: "normal", key: "new", render: () => "new", commit: (image) => { commits.push(image); } });
    release();
    await vi.advanceTimersByTimeAsync(101);
    expect(commits).toEqual(["new"]);
    scheduler.destroy();
    vi.useRealTimers();
  });
});
