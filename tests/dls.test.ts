import { describe, expect, it } from "vitest";
import { computeDls, computeRawScore, dlsState } from "../src/shared/dls";
import type { GuardEvent } from "../src/shared/types";

describe("dls", () => {
  it("computes base score and normalization", () => {
    const t = 1_700_000_000_000;
    const events: GuardEvent[] = [
      { type: "open_thread", ts: t },
      { type: "click_action", ts: t + 1 },
      { type: "reopen_same_thread", ts: t + 2 },
      { type: "undo_action", ts: t + 3 },
      { type: "context_switch", ts: t + 4 }
    ];
    const raw = computeRawScore(events, t + 4);
    // With minimal age, weights ~1. Raw ≈ 2 + 1 + 3 + 4 + 2 = 12
    expect(raw).toBeGreaterThan(11.5);
    const { dls } = computeDls(events, t + 4);
    expect(dls).toBeGreaterThanOrEqual(46);
  });

  it("caps indecision contribution at +10 per window", () => {
    const t = 1_700_000_000_000;
    const events: GuardEvent[] = [
      { type: "hover_indecision", ts: t, meta: { seconds: 9999 } }
    ];
    const raw = computeRawScore(events, t);
    expect(raw).toBe(10);
    const { dls } = computeDls(events, t);
    expect(dls).toBe(40);
  });

  it("states follow thresholds", () => {
    expect(dlsState(0)).toBe("GREEN");
    expect(dlsState(29)).toBe("GREEN");
    expect(dlsState(30)).toBe("AMBER");
    expect(dlsState(60)).toBe("AMBER");
    expect(dlsState(61)).toBe("RED");
  });
});

