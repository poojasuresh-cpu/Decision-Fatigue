import type {
  BackgroundToContentMessage,
  ClickAction,
  ContentToBackgroundMessage,
  DeferredThread,
  DlsState,
  GuardEvent,
  GuardState,
  ModelState
} from "@shared/types";
import { computeDls, dlsState, pruneWindow } from "@shared/dls";
import { computeFeatureVector } from "@shared/featureEngineering";
import {
  createLogRegModel,
  explainTopContributors,
  loadModelFromArtifacts,
  predictRisk,
  saveModelToArtifacts,
  trainModel,
  type StoredModelArtifacts,
  type StoredModelMeta,
  type TrainSample
} from "./model";
import { StorageKeys, storageGet, storageRemove, storageSet } from "./storage";

type PersistedSample = TrainSample;

const INPUT_DIM = 7;
const REOPEN_WITHIN_MS = 3 * 60 * 1000;

let events: GuardEvent[] = [];
let deferred: DeferredThread[] = [];
let samples: PersistedSample[] = [];
let model: import("@tensorflow/tfjs").LayersModel | null = null;
let modelMeta: StoredModelMeta | null = null;

let training = false;
let lastState: GuardState | null = null;
let lastEventType: GuardEvent["type"] | undefined;
let lastSampleTs = 0;
let persistTimer: number | null = null;
let tickTimer: number | null = null;

const ports = new Set<chrome.runtime.Port>();

function now(): number {
  return Date.now();
}

function toast(message: string): void {
  broadcast({ kind: "toast", message });
}

function broadcast(msg: BackgroundToContentMessage): void {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      // ignore
    }
  }
}

function schedulePersist(): void {
  if (persistTimer != null) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await storageSet(StorageKeys.events, events);
    await storageSet(StorageKeys.deferred, deferred);
    await storageSet(StorageKeys.samples, samples);
    if (modelMeta) await storageSet(StorageKeys.modelMeta, modelMeta);
  }, 800) as unknown as number;
}

async function loadPersisted(): Promise<void> {
  events = (await storageGet<GuardEvent[]>(StorageKeys.events)) ?? [];
  deferred = (await storageGet<DeferredThread[]>(StorageKeys.deferred)) ?? [];
  samples = (await storageGet<PersistedSample[]>(StorageKeys.samples)) ?? [];
  modelMeta = (await storageGet<StoredModelMeta>(StorageKeys.modelMeta)) ?? null;
  const artifacts = await storageGet<StoredModelArtifacts>(StorageKeys.modelArtifacts);
  if (artifacts) model = await loadModelFromArtifacts(artifacts, INPUT_DIM);
  if (!model) model = createLogRegModel(INPUT_DIM);
}

function effectiveState(base: DlsState, dls: number, risk?: number): DlsState {
  if (risk != null && risk > 0.65 && dls >= 45) return "RED";
  return base;
}

function normalizeHash(hash: string): string {
  if (!hash) return "";
  if (hash.startsWith("#")) return hash;
  return `#${hash}`;
}

function addEvent(e: GuardEvent): void {
  events.push(e);
  events = pruneWindow(events, now());
  lastEventType = e.type;
  schedulePersist();
}

function addSample(fv: number[], y: 0 | 1, ts: number): void {
  samples.push({ x: fv, y, ts });
  if (samples.length > 2000) samples = samples.slice(samples.length - 2000);
  schedulePersist();
}

async function computeAndBroadcast(): Promise<void> {
  const t = now();
  events = pruneWindow(events, t);
  const { dls, raw } = computeDls(events, t);
  const state = dlsState(dls);
  const fv = computeFeatureVector(events, t);

  // Pseudo-label sampling (throttled)
  if (t - lastSampleTs > 5000) {
    lastSampleTs = t;
    addSample(fv.values, dls > 60 ? 1 : 0, t);
  }

  let risk: number | undefined;
  let contributors: ModelState["top_contributors"];

  const hasTrainedModel = model != null && (modelMeta?.trainedAt ?? 0) > 0;
  if (hasTrainedModel && model) {
    risk = await predictRisk(model, fv.values);
    contributors = explainTopContributors(model, fv);
  }

  const eff = effectiveState(state, dls, risk);
  const modelState: ModelState = {
    available: hasTrainedModel,
    training,
    sample_count: samples.length,
    ...(modelMeta?.trainedAt ? { trained_at: modelMeta.trainedAt } : {}),
    ...(risk != null ? { overload_risk: risk } : {}),
    ...(contributors ? { top_contributors: contributors } : {})
  };

  lastState = {
    now: t,
    dls,
    raw_score: raw,
    state,
    effective_state: eff,
    window_event_count: events.length,
    ...(lastEventType ? { last_event_type: lastEventType } : {}),
    model: modelState
  };
  broadcast({ kind: "state", state: lastState });

  // Auto-train after enough data (low frequency)
  if (!training && samples.length >= 200) {
    const lastTrained = modelMeta?.trainedAt ?? 0;
    if (t - lastTrained > 10 * 60 * 1000) {
      void scheduleTraining("auto");
    }
  }
}

async function scheduleTraining(reason: "auto" | "manual"): Promise<void> {
  if (training) return;
  training = true;
  await computeAndBroadcast();

  // Keep CPU use low by training on a bounded, recent set.
  const trainSet = samples.slice(-800);
  const trainNow = async () => {
    try {
      if (!model) model = createLogRegModel(INPUT_DIM);
      await trainModel(model, trainSet, { epochs: 20, batchSize: 16 });
      const artifacts = await saveModelToArtifacts(model);
      await storageSet(StorageKeys.modelArtifacts, artifacts);
      modelMeta = { trainedAt: now() };
      await storageSet(StorageKeys.modelMeta, modelMeta);
      toast(`Model trained (${reason}).`);
    } catch (e) {
      console.warn("Training failed", e);
      toast("Model training failed (see console).");
    } finally {
      training = false;
      await computeAndBroadcast();
    }
  };

  // Defer slightly to avoid blocking immediate UI responsiveness.
  setTimeout(trainNow, 250);
}

function inferAction(label: string): ClickAction {
  const s = label.toLowerCase();
  if (s.includes("archive")) return "archive";
  if (s.includes("delete")) return "delete";
  if (s.includes("reply all") || s === "replyall") return "reply_all";
  if (s.includes("reply")) return "reply";
  if (s.includes("forward")) return "forward";
  return "other";
}

function handleSynthetic(count: number): void {
  const t = now();
  for (let i = 0; i < count; i++) {
    addEvent({ type: "open_thread", ts: t + i * 5, meta: { threadId: `sim_${i}` } });
    addEvent({ type: "click_action", ts: t + i * 5 + 1, meta: { action: "reply" } });
    addEvent({
      type: "hover_indecision",
      ts: t + i * 5 + 2,
      meta: { seconds: 8 }
    });
    addEvent({ type: "context_switch", ts: t + i * 5 + 3, meta: { kind: "blur" } });
    if (i % 4 === 0) addEvent({ type: "undo_action", ts: t + i * 5 + 4 });
    if (i % 3 === 0)
      addEvent({
        type: "reopen_same_thread",
        ts: t + i * 5 + 4,
        meta: { threadId: `sim_${i}` }
      });
  }
}

function maybeReopen(threadId: string, openTs: number): void {
  const recentOpen = [...events]
    .reverse()
    .find((e) => (e.type === "open_thread" || e.type === "reopen_same_thread") && e.meta?.threadId === threadId);
  if (!recentOpen) return;
  if (openTs - recentOpen.ts <= REOPEN_WITHIN_MS) {
    addEvent({ type: "reopen_same_thread", ts: openTs, meta: { threadId } });
  }
}

const threadOpenTs = new Map<string, number>();
function recordThreadOpen(threadId: string, ts: number): void {
  threadOpenTs.set(threadId, ts);
  maybeReopen(threadId, ts);
  addEvent({ type: "open_thread", ts, meta: { threadId } });
}

function recordThreadAction(threadId: string, ts: number, action: ClickAction): void {
  addEvent({ type: "click_action", ts, meta: { action } });
  const openTs = threadOpenTs.get(threadId);
  if (openTs != null) {
    threadOpenTs.delete(threadId);
    const seconds = Math.max(0, (ts - openTs) / 1000);
    addEvent({ type: "time_to_first_action", ts, meta: { seconds } });
  }
}

async function onMessage(msg: ContentToBackgroundMessage): Promise<void> {
  const t = now();
  switch (msg.kind) {
    case "event": {
      const e = msg.event;
      if (e.type === "open_thread") {
        const threadId = typeof e.meta?.threadId === "string" ? (e.meta.threadId as string) : "";
        if (threadId) recordThreadOpen(threadId, e.ts);
        else addEvent(e);
      } else if (e.type === "click_action") {
        const threadId = typeof e.meta?.threadId === "string" ? (e.meta.threadId as string) : "";
        const actionLabel = typeof e.meta?.label === "string" ? (e.meta.label as string) : "";
        const action =
          typeof e.meta?.action === "string"
            ? (e.meta.action as ClickAction)
            : inferAction(actionLabel);
        if (threadId) recordThreadAction(threadId, e.ts, action);
        else addEvent({ ...e, meta: { ...e.meta, action } });
      } else {
        addEvent(e);
      }
      await computeAndBroadcast();
      break;
    }
    case "defer_thread": {
      const h = normalizeHash(msg.thread.hash);
      const exists = deferred.some((d) => d.hash === h);
      if (!exists) deferred.unshift({ ...msg.thread, hash: h });
      deferred = deferred.slice(0, 200);
      addEvent({ type: "defer_thread", ts: t, meta: { hash: h } });
      schedulePersist();
      broadcast({ kind: "deferred", threads: deferred });
      toast("Added to Decision Inbox.");
      await computeAndBroadcast();
      break;
    }
    case "get_deferred":
      broadcast({ kind: "deferred", threads: deferred });
      break;
    case "remove_deferred":
      deferred = deferred.filter((d) => d.hash !== normalizeHash(msg.hash));
      schedulePersist();
      broadcast({ kind: "deferred", threads: deferred });
      break;
    case "simulate_overload":
      handleSynthetic(Math.max(1, Math.min(60, msg.count ?? 12)));
      await computeAndBroadcast();
      break;
    case "train_now":
      if (!training) await scheduleTraining("manual");
      break;
    case "manual_overload": {
      addEvent({ type: "manual_overload", ts: t, meta: { overloaded: msg.overloaded } });
      const fv = computeFeatureVector(events, t);
      addSample(fv.values, msg.overloaded ? 1 : 0, t);
      toast(msg.overloaded ? "Feedback recorded: overloaded." : "Feedback recorded: not overloaded.");
      await computeAndBroadcast();
      break;
    }
    case "clear_all":
      events = [];
      deferred = [];
      samples = [];
      modelMeta = null;
      threadOpenTs.clear();
      await storageRemove([
        StorageKeys.events,
        StorageKeys.deferred,
        StorageKeys.samples,
        StorageKeys.modelArtifacts,
        StorageKeys.modelMeta
      ]);
      toast("Local data cleared.");
      await computeAndBroadcast();
      broadcast({ kind: "deferred", threads: deferred });
      break;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (ports.size === 0 && tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  });

  // Start a tick so DLS visibly decays even without new events.
  if (tickTimer == null) {
    tickTimer = setInterval(() => {
      void computeAndBroadcast();
    }, 2000) as unknown as number;
  }

  if (lastState) port.postMessage({ kind: "state", state: lastState } satisfies BackgroundToContentMessage);
  port.postMessage({ kind: "deferred", threads: deferred } satisfies BackgroundToContentMessage);
});

chrome.runtime.onMessage.addListener((msg: ContentToBackgroundMessage, _sender, sendResponse) => {
  void onMessage(msg).then(() => sendResponse(true));
  return true;
});

void (async () => {
  await loadPersisted();
  await computeAndBroadcast();
})();
