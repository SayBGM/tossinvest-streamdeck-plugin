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
    await vi.advanceTimersByTimeAsync(40);
    expect(commits).toEqual(["two"]);
    vi.useRealTimers();
  });
});
