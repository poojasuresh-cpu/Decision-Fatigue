import type { DlsState, GuardEvent } from "./types";

export const WINDOW_MS = 30 * 60 * 1000;
export const HALF_LIFE_MS = 10 * 60 * 1000;

function decayWeight(ageMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

export function pruneWindow(events: GuardEvent[], now: number): GuardEvent[] {
  const cutoff = now - WINDOW_MS;
  let firstIdx = 0;
  while (firstIdx < events.length && events[firstIdx]!.ts < cutoff) firstIdx++;
  return firstIdx === 0 ? events : events.slice(firstIdx);
}

export function computeRawScore(events: GuardEvent[], now: number): number {
  const windowed = pruneWindow(events, now);
  let score = 0;
  let indecisionSeconds = 0;

  for (const e of windowed) {
    const w = decayWeight(now - e.ts);
    switch (e.type) {
      case "click_action":
        score += 1 * w;
        break;
      case "open_thread":
        score += 2 * w;
        break;
      case "reopen_same_thread":
        score += 3 * w;
        break;
      case "undo_action":
        score += 4 * w;
        break;
      case "context_switch":
        score += 2 * w;
        break;
      case "hover_indecision": {
        const sec = typeof e.meta?.seconds === "number" ? e.meta.seconds : 0;
        indecisionSeconds += sec * w;
        break;
      }
      default:
        break;
    }
  }

  // + (indecision_seconds / 20) capped at +10 per window
  const indecisionScore = Math.min(10, indecisionSeconds / 20);
  return score + indecisionScore;
}

export function computeDls(events: GuardEvent[], now: number): { dls: number; raw: number } {
  const raw = computeRawScore(events, now);
  const dls = Math.min(100, Math.round(raw * 4));
  return { dls, raw };
}

export function dlsState(dls: number): DlsState {
  if (dls < 30) return "GREEN";
  if (dls <= 60) return "AMBER";
  return "RED";
}

