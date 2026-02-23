import type { ClickAction, ContextSwitchKind, GuardEvent } from "@shared/types";
import type { GmailView } from "./gmailObserver";

function now(): number {
  return Date.now();
}

function closestAria(el: Element | null): Element | null {
  if (!el) return null;
  return el.closest("[aria-label], [data-tooltip], [role='button'], button, [role='menuitem']");
}

function getAriaLabel(el: Element): string {
  return (el.getAttribute("aria-label") ?? el.getAttribute("data-tooltip") ?? "").trim();
}

function classifyClickAction(label: string): ClickAction | null {
  const s = label.toLowerCase();
  if (!s) return null;
  if (s.includes("archive")) return "archive";
  if (s.includes("delete")) return "delete";
  if (s.includes("reply all")) return "reply_all";
  if (s === "reply" || s.includes("reply")) return "reply";
  if (s.includes("forward")) return "forward";
  return null;
}

function isUndoClick(el: Element, label: string): boolean {
  if (label.toLowerCase() === "undo") return true;
  if (el.textContent?.trim().toLowerCase() === "undo") return true;
  return false;
}

export function startEventCapture(opts: {
  getView: () => GmailView;
  send: (e: GuardEvent) => void;
}): () => void {
  const { getView, send } = opts;
  let lastDecisionTs = now();
  let indecisionRunning = false;
  let indecisionStart = 0;
  let indecisionAccum = 0;

  const markDecision = () => {
    lastDecisionTs = now();
    indecisionRunning = false;
    indecisionStart = 0;
    indecisionAccum = 0;
  };

  const onClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    const c = closestAria(target);
    if (!c) return;
    const label = getAriaLabel(c);
    if (!label && c.tagName.toLowerCase() !== "button") return;

    if (isUndoClick(c, label)) {
      markDecision();
      send({ type: "undo_action", ts: now() });
      return;
    }

    const action = classifyClickAction(label);
    if (action) {
      const view = getView();
      markDecision();
      send({
        type: "click_action",
        ts: now(),
        meta: {
          action,
          label,
          threadId: view.kind === "thread" ? view.threadId : undefined
        }
      });
      return;
    }
  };

  const isTypingTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    if (el.closest('[role="textbox"][contenteditable="true"]')) return true;
    return false;
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (isTypingTarget(ev.target)) return;

    // Gmail shortcuts (common defaults): '#' delete, 'e' archive, 'z' undo.
    // Also handle physical Delete key.
    const k = ev.key;
    let action: ClickAction | null = null;
    if (k === "#" || k === "Delete") action = "delete";
    else if (k.toLowerCase() === "e") action = "archive";
    else if (k.toLowerCase() === "z") {
      markDecision();
      send({ type: "undo_action", ts: now() });
      return;
    }

    if (action) {
      const view = getView();
      markDecision();
      send({
        type: "click_action",
        ts: now(),
        meta: {
          action,
          label: `kbd:${action}`,
          threadId: view.kind === "thread" ? view.threadId : undefined
        }
      });
    }
  };

  const onVisibility = () => {
    const kind: ContextSwitchKind =
      document.visibilityState === "hidden" ? "visibility_hidden" : "visibility_visible";
    send({ type: "context_switch", ts: now(), meta: { kind } });
  };
  const onBlur = () => send({ type: "context_switch", ts: now(), meta: { kind: "blur" } });
  const onFocus = () => send({ type: "context_switch", ts: now(), meta: { kind: "focus" } });

  const considerIndecision = () => {
    const t = now();
    const sinceDecision = t - lastDecisionTs;
    if (document.visibilityState !== "visible") return;

    if (sinceDecision > 8000) {
      if (!indecisionRunning) {
        indecisionRunning = true;
        indecisionStart = t;
      }
    } else {
      indecisionRunning = false;
      indecisionStart = 0;
    }

    if (indecisionRunning && indecisionStart) {
      const delta = (t - indecisionStart) / 1000;
      if (delta >= 2) {
        indecisionAccum += delta;
        indecisionStart = t;
        if (indecisionAccum >= 4) {
          send({ type: "hover_indecision", ts: t, meta: { seconds: indecisionAccum } });
          indecisionAccum = 0;
        }
      }
    }
  };

  const activity = () => considerIndecision();
  const timer = window.setInterval(considerIndecision, 1500);

  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousemove", activity, { passive: true });
  document.addEventListener("scroll", activity, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibility, { passive: true });
  window.addEventListener("blur", onBlur, { passive: true });
  window.addEventListener("focus", onFocus, { passive: true });

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousemove", activity);
    document.removeEventListener("scroll", activity, true as unknown as AddEventListenerOptions);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
  };
}
