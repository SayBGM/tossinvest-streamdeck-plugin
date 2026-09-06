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
});
