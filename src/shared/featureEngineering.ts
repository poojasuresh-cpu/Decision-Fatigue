import type { FeatureVectorNorm, FeatureVectorRaw, GuardEvent } from "./types";
import { pruneWindow, WINDOW_MS } from "./dls";

const FEATURE_NAMES: (keyof FeatureVectorRaw)[] = [
  "events_per_minute",
  "reopen_rate",
  "avg_time_to_action",
  "undo_rate",
  "context_switch_rate",
  "indecision_time_ratio",
  "decision_variety_count"
];

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function computeFeaturesRaw(events: GuardEvent[], now: number): FeatureVectorRaw {
  const windowed = pruneWindow(events, now);
  const windowMinutes = WINDOW_MS / 60000;
  const windowSeconds = WINDOW_MS / 1000;

  const totalEvents = windowed.filter(
    (e) =>
      e.type !== "time_to_first_action" &&
      e.type !== "defer_thread" &&
      e.type !== "manual_overload"
  ).length;

  let opens = 0;
  let reopens = 0;
  let clicks = 0;
  let undos = 0;
  let contextSwitches = 0;
  let indecisionSeconds = 0;
  const timeToFirstActionSeconds: number[] = [];
  const decisionVariety = new Set<string>();

  for (const e of windowed) {
    switch (e.type) {
      case "open_thread":
        opens++;
        break;
      case "reopen_same_thread":
        reopens++;
        break;
      case "click_action":
        clicks++;
        if (typeof e.meta?.action === "string") decisionVariety.add(e.meta.action);
        break;
      case "undo_action":
        undos++;
        break;
      case "context_switch":
        contextSwitches++;
        break;
      case "hover_indecision":
        if (typeof e.meta?.seconds === "number") indecisionSeconds += e.meta.seconds;
        break;
      case "time_to_first_action":
        if (typeof e.meta?.seconds === "number") timeToFirstActionSeconds.push(e.meta.seconds);
        break;
      default:
        break;
    }
  }

  const avgTimeToAction =
    timeToFirstActionSeconds.length === 0
      ? 0
      : timeToFirstActionSeconds.reduce((a, b) => a + b, 0) / timeToFirstActionSeconds.length;

  return {
    events_per_minute: totalEvents / windowMinutes,
    reopen_rate: opens === 0 ? 0 : reopens / opens,
    avg_time_to_action: avgTimeToAction,
    undo_rate: clicks === 0 ? 0 : undos / clicks,
    context_switch_rate: contextSwitches / windowMinutes,
    indecision_time_ratio: clamp01(indecisionSeconds / windowSeconds),
    decision_variety_count: decisionVariety.size
  };
}

export function normalizeFeatures(raw: FeatureVectorRaw): FeatureVectorNorm {
  // Simple bounded normalization for on-device logistic regression.
  // Keep these conservative to avoid brittle scaling.
  const normalized: Record<keyof FeatureVectorRaw, number> = {
    events_per_minute: clamp01(raw.events_per_minute / 12), // 12 events/min is "very busy"
    reopen_rate: clamp01(raw.reopen_rate / 0.8),
    avg_time_to_action: clamp01(raw.avg_time_to_action / 60), // 60s+ is slow
    undo_rate: clamp01(raw.undo_rate / 0.3),
    context_switch_rate: clamp01(raw.context_switch_rate / 2),
    indecision_time_ratio: clamp01(raw.indecision_time_ratio),
    decision_variety_count: clamp01(raw.decision_variety_count / 5)
  };

  return {
    values: FEATURE_NAMES.map((n) => normalized[n]),
    names: FEATURE_NAMES,
    raw
  };
}

export function computeFeatureVector(events: GuardEvent[], now: number): FeatureVectorNorm {
  return normalizeFeatures(computeFeaturesRaw(events, now));
}

