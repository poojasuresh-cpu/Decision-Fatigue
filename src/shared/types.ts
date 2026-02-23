export type DlsState = "GREEN" | "AMBER" | "RED";

export type EventType =
  | "click_action"
  | "open_thread"
  | "back_to_inbox"
  | "reopen_same_thread"
  | "undo_action"
  | "context_switch"
  | "hover_indecision"
  | "time_to_first_action"
  | "defer_thread"
  | "manual_overload";

export type ClickAction =
  | "archive"
  | "delete"
  | "reply"
  | "reply_all"
  | "forward"
  | "other";

export type ContextSwitchKind = "visibility_hidden" | "visibility_visible" | "blur" | "focus";

export type GuardEvent = {
  type: EventType;
  ts: number; // epoch ms
  meta?: Record<string, unknown>;
};

export type DeferredThread = {
  hash: string; // Gmail URL hash fragment only (no content)
  ts: number;
  source: "inbox" | "thread";
};

export type FeatureVectorRaw = {
  events_per_minute: number;
  reopen_rate: number;
  avg_time_to_action: number; // seconds
  undo_rate: number;
  context_switch_rate: number;
  indecision_time_ratio: number; // 0..1
  decision_variety_count: number;
};

export type FeatureVectorNorm = {
  values: number[]; // fixed order for the model
  names: (keyof FeatureVectorRaw)[];
  raw: FeatureVectorRaw;
};

export type ModelState = {
  available: boolean;
  overload_risk?: number; // 0..1
  top_contributors?: { name: keyof FeatureVectorRaw; contribution: number }[];
  training?: boolean;
  trained_at?: number;
  sample_count?: number;
};

export type GuardState = {
  now: number;
  dls: number;
  state: DlsState;
  effective_state: DlsState; // can be RED due to early-warning rule
  raw_score: number;
  window_event_count: number;
  last_event_type?: EventType;
  model: ModelState;
};

export type ContentToBackgroundMessage =
  | { kind: "event"; event: GuardEvent }
  | { kind: "defer_thread"; thread: DeferredThread }
  | { kind: "get_deferred" }
  | { kind: "remove_deferred"; hash: string }
  | { kind: "clear_all" }
  | { kind: "simulate_overload"; count?: number }
  | { kind: "train_now" }
  | { kind: "manual_overload"; overloaded: boolean };

export type BackgroundToContentMessage =
  | { kind: "state"; state: GuardState }
  | { kind: "deferred"; threads: DeferredThread[] }
  | { kind: "toast"; message: string };
