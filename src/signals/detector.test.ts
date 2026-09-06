import { describe, expect, it } from "vitest";
import {
  createSignalMemory,
  detectSignal,
  type SignalInput,
} from "./detector.js";

const SESSION = "2026-09-07:70000";

function baseInput(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    lastPrice: 70000,
    referencePrice: 70000,
    market: "KR",
    sessionKey: SESSION,
    timestamp: "2026-09-07T01:00:00Z",
    priceText: "70000",
    movingAverages: [],
    ...overrides,
  };
}

describe("detectSignal", () => {
  it("does not fire on the first (arming) evaluation, even if already past a threshold", () => {
    const memory = createSignalMemory();
    const signal = detectSignal(
      memory,
      baseInput({ lastPrice: 77000, referencePrice: 70000 }),
    );
    expect(signal).toBeUndefined();
  });

  it("fires once when crossing +10%", () => {
    const memory = createSignalMemory();
    // Arm at the reference level.
    detectSignal(memory, baseInput({ lastPrice: 70000 }));
    const signal = detectSignal(memory, baseInput({ lastPrice: 77000 }));
    expect(signal).toMatchObject({
      kind: "rate-up",
      label: "10% 상승",
      sentiment: "bullish",
    });
  });

  it("shows only the 15% signal when jumping from below 5% straight to 15%, without an intermediate 10% signal", () => {
    const memory = createSignalMemory();
    detectSignal(memory, baseInput({ lastPrice: 70000 })); // arm
    const jump = detectSignal(memory, baseInput({ lastPrice: 80500 })); // +15%
    expect(jump).toMatchObject({ kind: "rate-up", label: "15% 상승" });
    // 10% must now be considered already-fired, not something still pending.
    const retreatToTen = detectSignal(
      memory,
      baseInput({ lastPrice: 77000 }),
    ); // +10%, still up but a lower level
    expect(retreatToTen).toBeUndefined();
  });

  it("does not re-fire the same level after retreating and re-crossing it", () => {
    const memory = createSignalMemory();
    detectSignal(memory, baseInput({ lastPrice: 70000 })); // arm
    const first = detectSignal(memory, baseInput({ lastPrice: 77000 })); // +10%
    expect(first).toMatchObject({ label: "10% 상승" });
    const retreat = detectSignal(memory, baseInput({ lastPrice: 71000 })); // back to +1.4%
    expect(retreat).toBeUndefined();
    const recross = detectSignal(memory, baseInput({ lastPrice: 77500 })); // +10.7%, still level 2
    expect(recross).toBeUndefined();
  });

  it("re-arms (without firing) when the session key changes", () => {
    const memory = createSignalMemory();
    detectSignal(memory, baseInput({ lastPrice: 70000 })); // arm session 1
    detectSignal(memory, baseInput({ lastPrice: 77000 })); // fires +10%

    const nextSessionInput = baseInput({
      sessionKey: "2026-09-08:71000",
      referencePrice: 71000,
      lastPrice: 78100, // +10% again, but a new session
      timestamp: "2026-09-08T01:00:00Z",
    });
    const armed = detectSignal(memory, nextSessionInput);
    expect(armed).toBeUndefined();

    const fired = detectSignal(
      memory,
      baseInput({
        sessionKey: "2026-09-08:71000",
        referencePrice: 71000,
        lastPrice: 85200, // +20%
        timestamp: "2026-09-08T01:05:00Z",
      }),
    );
    expect(fired).toMatchObject({ label: "20% 상승" });
  });

  it("prioritizes upper-limit over a simultaneous 30% rate level", () => {
    const memory = createSignalMemory();
    detectSignal(
      memory,
      baseInput({ lastPrice: 70000, upperLimit: 91000 }),
    ); // arm
    const signal = detectSignal(
      memory,
      baseInput({ lastPrice: 91000, upperLimit: 91000 }),
    ); // exactly +30% AND at the upper limit
    expect(signal).toMatchObject({ kind: "upper-limit", label: "상한가" });
  });

  it("fires lower-limit with bearish sentiment, once per session", () => {
    const memory = createSignalMemory();
    detectSignal(memory, baseInput({ lastPrice: 70000, lowerLimit: 49000 })); // arm
    const first = detectSignal(
      memory,
      baseInput({ lastPrice: 49000, lowerLimit: 49000 }),
    );
    expect(first).toMatchObject({ kind: "lower-limit", label: "하한가", sentiment: "bearish" });
    const again = detectSignal(
      memory,
      baseInput({ lastPrice: 49000, lowerLimit: 49000 }),
    );
    expect(again).toBeUndefined();
  });

  it("US stocks have no price limit, so only rate levels can fire even far past 30%", () => {
    const memory = createSignalMemory();
    detectSignal(
      memory,
      baseInput({ market: "US", lastPrice: 100, referencePrice: 100 }),
    ); // arm
    const signal = detectSignal(
      memory,
      baseInput({ market: "US", lastPrice: 140, referencePrice: 100 }),
    ); // +40%, no upperLimit provided
    expect(signal).toMatchObject({ kind: "rate-up", label: "40% 상승" });
  });

  it("fires 35% and 40% levels with no upper cap", () => {
    const memory = createSignalMemory();
    detectSignal(memory, baseInput({ lastPrice: 100, referencePrice: 100 })); // arm
    const thirtyFive = detectSignal(
      memory,
      baseInput({ lastPrice: 135, referencePrice: 100 }),
    );
    expect(thirtyFive).toMatchObject({ label: "35% 상승" });
    const forty = detectSignal(
      memory,
      baseInput({ lastPrice: 140, referencePrice: 100 }),
    );
    expect(forty).toMatchObject({ label: "40% 상승" });
  });

  it("fires ma-break-up and ma-break-down once each per crossing direction", () => {
    const memory = createSignalMemory();
    detectSignal(
      memory,
      baseInput({
        lastPrice: 100,
        movingAverages: [{ period: 60, value: 105 }], // arm below
      }),
    );
    const up = detectSignal(
      memory,
      baseInput({
        lastPrice: 110,
        movingAverages: [{ period: 60, value: 105 }],
      }),
    );
    expect(up).toMatchObject({ kind: "ma-break-up", label: "60일선 돌파", sentiment: "bullish" });

    // Crossing back up again without dropping below first must not re-fire.
    const stillAbove = detectSignal(
      memory,
      baseInput({
        lastPrice: 112,
        movingAverages: [{ period: 60, value: 105 }],
      }),
    );
    expect(stillAbove).toBeUndefined();

    const down = detectSignal(
      memory,
      baseInput({
        lastPrice: 95,
        movingAverages: [{ period: 60, value: 105 }],
      }),
    );
    expect(down).toMatchObject({ kind: "ma-break-down", label: "60일선 이탈", sentiment: "bearish" });

    // Break down again — already fired for the "below" direction, no re-fire.
    const stillBelow = detectSignal(
      memory,
      baseInput({
        lastPrice: 96,
        movingAverages: [
          { period: 60, value: 105 },
        ],
      }),
    );
    // Note: 96 is still below 105, so no side change at all; expect undefined.
    expect(stillBelow).toBeUndefined();
  });

  it("prioritizes 120-day over 60-day over 20-day when multiple MAs cross simultaneously", () => {
    const memory = createSignalMemory();
    detectSignal(
      memory,
      baseInput({
        lastPrice: 90,
        movingAverages: [
          { period: 20, value: 100 },
          { period: 60, value: 100 },
          { period: 120, value: 100 },
        ],
      }),
    ); // arm, all below
    const signal = detectSignal(
      memory,
      baseInput({
        lastPrice: 110,
        movingAverages: [
          { period: 20, value: 100 },
          { period: 60, value: 100 },
          { period: 120, value: 100 },
        ],
      }),
    ); // all three cross above simultaneously
    expect(signal).toMatchObject({ label: "120일선 돌파" });
  });

  it("skips a period with no available moving-average value", () => {
    const memory = createSignalMemory();
    detectSignal(
      memory,
      baseInput({ lastPrice: 90, movingAverages: [{ period: 60, value: 100 }] }),
    );
    const signal = detectSignal(
      memory,
      baseInput({ lastPrice: 110, movingAverages: [{ period: 60, value: 100 }] }),
    );
    expect(signal).toMatchObject({ kind: "ma-break-up" });
  });
});
