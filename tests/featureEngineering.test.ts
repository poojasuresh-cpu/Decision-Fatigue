import { describe, expect, it } from "vitest";
import { computeFeaturesRaw, normalizeFeatures } from "../src/shared/featureEngineering";
import type { GuardEvent } from "../src/shared/types";

describe("featureEngineering", () => {
  it("computes key rates and variety", () => {
    const t = 1_700_000_000_000;
    const events: GuardEvent[] = [
      { type: "open_thread", ts: t },
      { type: "click_action", ts: t + 1, meta: { action: "reply" } },
      { type: "click_action", ts: t + 2, meta: { action: "archive" } },
      { type: "undo_action", ts: t + 3 },
      { type: "context_switch", ts: t + 4, meta: { kind: "blur" } },
      { type: "hover_indecision", ts: t + 5, meta: { seconds: 10 } },
      { type: "time_to_first_action", ts: t + 6, meta: { seconds: 5 } }
    ];
    const raw = computeFeaturesRaw(events, t + 10);
    expect(raw.decision_variety_count).toBe(2);
    expect(raw.avg_time_to_action).toBe(5);
    expect(raw.undo_rate).toBeCloseTo(1 / 2);
    expect(raw.indecision_time_ratio).toBeGreaterThan(0);

    const norm = normalizeFeatures(raw);
    expect(norm.values.length).toBe(7);
    for (const v of norm.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

