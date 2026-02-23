import type { DeferredThread, GuardState } from "@shared/types";
import type { GmailView } from "./gmailObserver";
import { UiOverlay } from "./uiOverlay";

function now(): number {
  return Date.now();
}

function setHtmlMode(effective: GuardState["effective_state"]): void {
  document.documentElement.classList.remove("dfg-green", "dfg-amber", "dfg-red");
  if (effective === "GREEN") document.documentElement.classList.add("dfg-green");
  else if (effective === "AMBER") document.documentElement.classList.add("dfg-amber");
  else document.documentElement.classList.add("dfg-red");
}

function ensureCategoryBadges(on: boolean): void {
  const targets = [
    { label: "Social", key: "social" },
    { label: "Promotions", key: "promotions" },
    { label: "Updates", key: "updates" },
    { label: "Forums", key: "forums" }
  ];
  for (const t of targets) {
    const tab = document.querySelector(`[role="tab"][aria-label="${t.label}"]`);
    if (!tab) continue;
    const existing = tab.querySelector(`.dfg-cat-badge[data-dfg="${t.key}"]`) as HTMLElement | null;
    if (!on) {
      existing?.remove();
      continue;
    }
    if (!existing) {
      const badge = document.createElement("span");
      badge.className = "dfg-cat-badge";
      badge.dataset.dfg = t.key;
      badge.textContent = "Review later";
      tab.appendChild(badge);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function findButtonByAriaRegex(re: RegExp): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[aria-label],[data-tooltip]"));
  for (const c of candidates) {
    const label = (c.getAttribute("aria-label") ?? c.getAttribute("data-tooltip") ?? "").trim();
    if (label && re.test(label)) return c;
  }
  return null;
}

async function insertIntoReplyBox(text: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const box =
      (document.querySelector(
        'div[role="textbox"][contenteditable="true"][aria-label]'
      ) as HTMLDivElement | null) ??
      (document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLDivElement | null);
    if (box) {
      box.focus();
      document.execCommand("insertText", false, text);
      return true;
    }
    await sleep(150);
  }
  return false;
}

export function createInterventions(opts: {
  overlay: UiOverlay;
  sendDefer: (t: DeferredThread) => void;
}): {
  setState: (state: GuardState, view: GmailView) => void;
  installReplyAllGuard: () => () => void;
} {
  const { overlay, sendDefer } = opts;
  let current: GuardState | null = null;
  let currentView: GmailView | null = null;
  let bypassReplyAll = false;

  const apply = (state: GuardState, view: GmailView) => {
    current = state;
    currentView = view;
    setHtmlMode(state.effective_state);
    ensureCategoryBadges(view.kind === "inbox" && state.effective_state === "RED");

    const showMini =
      view.kind === "thread" && (state.effective_state === "AMBER" || state.effective_state === "RED");
    overlay.setMiniBar(
      showMini,
      state.effective_state,
      async () => {
        const replyBtn = findButtonByAriaRegex(/^Reply$/i) ?? findButtonByAriaRegex(/^Reply\b/i);
        if (replyBtn) {
          replyBtn.click();
          const ok = await insertIntoReplyBox("Thanks—got it. I’ll follow up shortly.\n");
          overlay.showToast(ok ? "Quick reply inserted (not sent)." : "Could not find reply box yet.");
        } else {
          overlay.showToast("Reply button not found (Gmail UI changed).");
        }
      },
      () => {
        if (view.kind !== "thread") return;
        sendDefer({ hash: view.hash, ts: now(), source: "thread" });
      }
    );
  };

  const installReplyAllGuard = () => {
    const handler = async (ev: MouseEvent) => {
      if (bypassReplyAll) return;
      const s = current;
      const view = currentView;
      if (!s || !view || view.kind !== "thread") return;
      if (s.effective_state !== "RED") return;

      const target = ev.target as Element | null;
      const el = target?.closest("[aria-label],[data-tooltip],[role='button'],button");
      if (!el) return;
      const label = (el.getAttribute("aria-label") ?? el.getAttribute("data-tooltip") ?? "").trim();
      if (!/reply all/i.test(label)) return;

      ev.preventDefault();
      ev.stopPropagation();
      const ok = await overlay.confirmReplyAll();
      if (!ok) return;
      bypassReplyAll = true;
      try {
        (el as HTMLElement).click();
      } finally {
        setTimeout(() => {
          bypassReplyAll = false;
        }, 500);
      }
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  };

  return { setState: apply, installReplyAllGuard };
}

