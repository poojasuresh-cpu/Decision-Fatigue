import stylesText from "./styles.css?inline";
import type { BackgroundToContentMessage, DeferredThread, GuardEvent, GuardState } from "@shared/types";
import { startGmailObserver, type GmailView } from "./gmailObserver";
import { startEventCapture } from "./eventCapture";
import { UiOverlay } from "./uiOverlay";
import { createInterventions } from "./interventions";

declare global {
  interface Window {
    __DFG_LOADED__?: boolean;
  }
}

if (!window.__DFG_LOADED__) {
  window.__DFG_LOADED__ = true;

  let currentView: GmailView = { kind: "inbox", hash: "#" };
  let currentState: GuardState | null = null;

  const sendMessage = (msg: import("@shared/types").ContentToBackgroundMessage) => {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // ignore
    }
  };

  const overlay = new UiOverlay(stylesText, {
    onTogglePanel: () => overlay.togglePanel(),
    onSimulateOverload: () => sendMessage({ kind: "simulate_overload", count: 14 }),
    onClearAll: () => sendMessage({ kind: "clear_all" }),
    onTrainNow: () => sendMessage({ kind: "train_now" }),
    onManualOverload: (overloaded) => sendMessage({ kind: "manual_overload", overloaded }),
    onGetDeferred: () => sendMessage({ kind: "get_deferred" }),
    onOpenDeferred: (hash) => {
      location.hash = hash.startsWith("#") ? hash : `#${hash}`;
      overlay.showToast("Opening deferred thread...");
    },
    onRemoveDeferred: (hash) => sendMessage({ kind: "remove_deferred", hash })
  });

  const interventions = createInterventions({
    overlay,
    sendDefer: (t: DeferredThread) => sendMessage({ kind: "defer_thread", thread: t })
  });
  const uninstallGuard = interventions.installReplyAllGuard();

  const port = chrome.runtime.connect({ name: "dfg" });
  port.onMessage.addListener((msg: BackgroundToContentMessage) => {
    if (msg.kind === "state") {
      currentState = msg.state;
      overlay.setState(msg.state);
      interventions.setState(msg.state, currentView);
    } else if (msg.kind === "deferred") {
      overlay.setDeferred(msg.threads);
    } else if (msg.kind === "toast") {
      overlay.showToast(msg.message);
    }
  });

  const sendEvent = (event: GuardEvent) => sendMessage({ kind: "event", event });

  const stopObserver = startGmailObserver((view) => {
    const prev = currentView;
    currentView = view;
    if (currentState) interventions.setState(currentState, currentView);

    if (view.kind === "thread" && (prev.kind !== "thread" || prev.threadId !== view.threadId)) {
      sendEvent({ type: "open_thread", ts: Date.now(), meta: { threadId: view.threadId } });
    }
    if (view.kind === "inbox" && prev.kind === "thread") {
      sendEvent({ type: "back_to_inbox", ts: Date.now() });
    }
  });

  const stopCapture = startEventCapture({
    getView: () => currentView,
    send: sendEvent
  });

  window.addEventListener(
    "beforeunload",
    () => {
      stopObserver();
      stopCapture();
      uninstallGuard();
      overlay.destroy();
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    },
    { once: true }
  );
}

