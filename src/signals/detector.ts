import type { Market, Signal } from "../types.js";

export interface SignalInput {
  readonly lastPrice: number;
  readonly referencePrice: number;
  readonly market: Market;
  readonly sessionKey: string;
  readonly timestamp: string;
  readonly priceText: string;
  readonly upperLimit?: number;
  readonly lowerLimit?: number;
  readonly movingAverages: ReadonlyArray<{
    readonly period: 20 | 60 | 120;
    readonly value: number;
  }>;
}

export interface SignalMemory {
  sessionKey?: string;
  firedRateLevels: Set<number>;
  atUpperLimit: boolean;
  atLowerLimit: boolean;
  maSide: Map<number, "above" | "below">;
  firedMa: Set<string>;
}

export function createSignalMemory(): SignalMemory {
  return {
    sessionKey: undefined,
    firedRateLevels: new Set<number>(),
    atUpperLimit: false,
    atLowerLimit: false,
    maSide: new Map<number, "above" | "below">(),
    firedMa: new Set<string>(),
  };
}

function resetMemory(memory: SignalMemory, sessionKey: string): void {
  memory.sessionKey = sessionKey;
  memory.firedRateLevels = new Set<number>();
  memory.atUpperLimit = false;
  memory.atLowerLimit = false;
  memory.maSide = new Map<number, "above" | "below">();
  memory.firedMa = new Set<string>();
}

/**
 * Upper/lower price-limit detection. Once a limit is reached within a
 * session it stays "reached" for the rest of the session (no reset if price
 * retreats), so it fires at most once per session.
 */
function evaluateLimit(
  memory: SignalMemory,
  input: SignalInput,
  arm: boolean,
): Signal | undefined {
  let candidate: Signal | undefined;

  if (input.upperLimit !== undefined && input.lastPrice >= input.upperLimit) {
    if (!memory.atUpperLimit && !arm) {
      candidate = {
        kind: "upper-limit",
        label: "상한가",
        sentiment: "bullish",
        price: input.priceText,
        at: input.timestamp,
      };
    }
    memory.atUpperLimit = true;
  }

  if (input.lowerLimit !== undefined && input.lastPrice <= input.lowerLimit) {
    if (!memory.atLowerLimit && !arm && !candidate) {
      candidate = {
        kind: "lower-limit",
        label: "하한가",
        sentiment: "bearish",
        price: input.priceText,
        at: input.timestamp,
      };
    }
    memory.atLowerLimit = true;
  }

  return candidate;
}

/**
 * ±5% rate-level detection with no cap (35%, 40%, ... all valid). A level
 * jump (5% -> 15%) fires only the level actually reached, and every
 * intermediate level of the same sign is marked fired at once so it never
 * separately fires later. Retreating and re-crossing an already-fired level
 * never re-fires it.
 */
function evaluateRate(
  memory: SignalMemory,
  input: SignalInput,
  arm: boolean,
): Signal | undefined {
  if (!Number.isFinite(input.referencePrice) || input.referencePrice === 0) {
    return undefined;
  }
  const rate =
    ((input.lastPrice - input.referencePrice) / input.referencePrice) * 100;
  if (!Number.isFinite(rate)) return undefined;

  const sign = rate > 0 ? 1 : rate < 0 ? -1 : 0;
  const absLevel = Math.floor(Math.abs(rate) / 5);
  if (sign === 0 || absLevel === 0) return undefined;

  const level = sign * absLevel;
  if (memory.firedRateLevels.has(level)) return undefined;

  let candidate: Signal | undefined;
  if (!arm) {
    const pct = absLevel * 5;
    candidate = {
      kind: sign > 0 ? "rate-up" : "rate-down",
      label: `${pct}% ${sign > 0 ? "상승" : "하락"}`,
      sentiment: sign > 0 ? "bullish" : "bearish",
      price: input.priceText,
      at: input.timestamp,
    };
  }

  for (let i = 1; i <= absLevel; i += 1) {
    memory.firedRateLevels.add(sign * i);
  }

  return candidate;
}

/**
 * Moving-average breakout/breakdown detection for the 20/60/120-day
 * averages. A crossover fires only when the side (above/below) actually
 * changes from the previously observed side, and each (period, direction)
 * pair fires at most once per session. Priority among simultaneous
 * crossovers is 120 > 60 > 20, expressed here by evaluating in that order
 * and keeping only the first candidate found (while still updating memory
 * for every period).
 */
function evaluateMa(
  memory: SignalMemory,
  input: SignalInput,
  arm: boolean,
): Signal | undefined {
  const ordered = [...input.movingAverages].sort((a, b) => b.period - a.period);
  let candidate: Signal | undefined;

  for (const ma of ordered) {
    if (!Number.isFinite(ma.value)) continue;
    const side: "above" | "below" =
      input.lastPrice >= ma.value ? "above" : "below";
    const previousSide = memory.maSide.get(ma.period);
    memory.maSide.set(ma.period, side);

    if (previousSide === undefined || previousSide === side) continue;

    const key = `${ma.period}:${side}`;
    if (memory.firedMa.has(key)) continue;
    memory.firedMa.add(key);

    if (!arm && !candidate) {
      candidate = {
        kind: side === "above" ? "ma-break-up" : "ma-break-down",
        label:
          side === "above"
            ? `${ma.period}일선 돌파`
            : `${ma.period}일선 이탈`,
        sentiment: side === "above" ? "bullish" : "bearish",
        price: input.priceText,
        at: input.timestamp,
      };
    }
  }

  return candidate;
}

/**
 * Pure signal detector. `memory` is mutated in place to track per-symbol
 * state across calls; the return value is the single highest-priority
 * signal to show for this evaluation, or `undefined` if nothing should be
 * shown (including during arming, the first evaluation of a session).
 *
 * Priority when multiple conditions are met simultaneously:
 * upper/lower limit > rate level (largest) > moving average (120 > 60 > 20).
 * All detectors still update their memory even when their result is not the
 * one returned, so a later, lower-priority evaluation does not re-fire for
 * a condition that already happened.
 */
export function detectSignal(
  memory: SignalMemory,
  input: SignalInput,
): Signal | undefined {
  const arm = memory.sessionKey !== input.sessionKey;
  if (arm) resetMemory(memory, input.sessionKey);

  const limitSignal = evaluateLimit(memory, input, arm);
  const rateSignal = evaluateRate(memory, input, arm);
  const maSignal = evaluateMa(memory, input, arm);

  return limitSignal ?? rateSignal ?? maSignal;
}
