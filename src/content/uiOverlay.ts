import type { DeferredThread, GuardState } from "@shared/types";

export type OverlayHandlers = {
  onTogglePanel: () => void;
  onSimulateOverload: () => void;
  onClearAll: () => void;
  onTrainNow: () => void;
  onManualOverload: (overloaded: boolean) => void;
  onGetDeferred: () => void;
  onOpenDeferred: (hash: string) => void;
  onRemoveDeferred: (hash: string) => void;
};

function fmtStateColor(state: GuardState["effective_state"]): string {
  if (state === "GREEN") return "var(--dfg-green)";
  if (state === "AMBER") return "var(--dfg-amber)";
  return "var(--dfg-red)";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export class UiOverlay {
  private root: HTMLDivElement;
  private pill: HTMLButtonElement;
  private dot: HTMLSpanElement;
  private title: HTMLSpanElement;
  private sub: HTMLSpanElement;
  private panel: HTMLDivElement;
  private panelBody: HTMLDivElement;
  private toast: HTMLDivElement;
  private miniBar: HTMLDivElement;
  private modal: HTMLDivElement;
  private deferred: DeferredThread[] = [];
  private state: GuardState | null = null;

  private devMode = false;
  private overloaded = false;

  constructor(private stylesText: string, private handlers: OverlayHandlers) {
    this.root = el("div", { id: "dfg-root" });

    const style = el("style");
    style.textContent = stylesText;
    this.root.appendChild(style);

    this.pill = el("button", { id: "dfg-pill", type: "button" });
    this.dot = el("span", { class: "dfg-dot" });
    const wrap = el("span");
    this.title = el("span", { class: "dfg-title" });
    this.sub = el("span", { class: "dfg-sub" });
    wrap.appendChild(this.title);
    wrap.appendChild(el("br"));
    wrap.appendChild(this.sub);
    this.pill.appendChild(this.dot);
    this.pill.appendChild(wrap);
    this.pill.addEventListener("click", () => this.handlers.onTogglePanel());
    this.root.appendChild(this.pill);

    this.panel = el("div", { id: "dfg-panel" });
    const header = el("header");
    const h = el("div", { class: "dfg-h" });
    const h3 = el("h3");
    h3.textContent = "Decision Inbox";
    const hint = el("span");
    hint.textContent = "local-only";
    h.appendChild(h3);
    h.appendChild(hint);
    const closeBtn = el("button", { type: "button" });
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => this.handlers.onTogglePanel());
    header.appendChild(h);
    header.appendChild(closeBtn);
    this.panelBody = el("div", { class: "dfg-body" });
    this.panel.appendChild(header);
    this.panel.appendChild(this.panelBody);
    this.root.appendChild(this.panel);

    this.miniBar = el("div", { id: "dfg-mini-bar" });
    this.root.appendChild(this.miniBar);

    this.toast = el("div", { id: "dfg-toast" });
    this.root.appendChild(this.toast);

    this.modal = el("div", { id: "dfg-modal" });
    this.root.appendChild(this.modal);

    document.documentElement.appendChild(this.root);

    this.handlers.onGetDeferred();
  }

  destroy(): void {
    this.root.remove();
  }

  togglePanel(): void {
    this.panel.classList.toggle("dfg-open");
    this.renderPanel();
  }

  setState(state: GuardState): void {
    this.state = state;
    const color = fmtStateColor(state.effective_state);
    this.dot.style.background = color;
    const risk = state.model.available && state.model.overload_risk != null ? state.model.overload_risk : null;
    const riskTxt = risk == null ? "" : ` • Risk ${(risk * 100).toFixed(0)}%`;
    this.title.textContent = `DLS ${state.dls} • ${state.effective_state}${riskTxt}`;
    this.sub.textContent = state.model.training ? "Training ML (local)..." : "Click for inbox + settings";

    if (this.panel.classList.contains("dfg-open")) this.renderPanel();
  }

  setDeferred(threads: DeferredThread[]): void {
    this.deferred = threads;
    if (this.panel.classList.contains("dfg-open")) this.renderPanel();
  }

  setMiniBar(
    visible: boolean,
    mode: "AMBER" | "RED" | "GREEN",
    onQuick: () => void,
    onDefer: () => void
  ): void {
    if (!visible || mode === "GREEN") {
      this.miniBar.classList.remove("dfg-show");
      this.miniBar.textContent = "";
      return;
    }
    this.miniBar.classList.add("dfg-show");
    this.miniBar.textContent = "";

    const title = el("div", { class: "dfg-mini-title" });
    title.textContent = mode === "RED" ? "Overload mode" : "Recommended action";
    const sub = el("div", { class: "dfg-mini-sub" });
    sub.textContent =
      mode === "RED"
        ? "Keep it simple: quick reply or decide later."
        : "Two-click options to reduce decision load.";
    const actions = el("div", { class: "dfg-actions" });
    const quick = el("button", { type: "button", class: mode === "AMBER" ? "dfg-primary" : "" });
    quick.textContent = "Quick reply";
    quick.addEventListener("click", onQuick);
    const defer = el("button", { type: "button", class: mode === "RED" ? "dfg-primary" : "" });
    defer.textContent = "Decide later";
    defer.addEventListener("click", onDefer);
    actions.appendChild(quick);
    actions.appendChild(defer);

    this.miniBar.appendChild(title);
    this.miniBar.appendChild(sub);
    this.miniBar.appendChild(actions);
  }

  showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("dfg-show");
    window.setTimeout(() => this.toast.classList.remove("dfg-show"), 2200);
  }

  async confirmReplyAll(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.modal.textContent = "";
      const card = el("div", { class: "dfg-modal-card" });
      const h4 = el("h4");
      h4.textContent = "Reply all is guarded";
      const p = el("p");
      p.textContent =
        "You’re in RED overload mode. Reply all can increase coordination load. Proceed only if truly necessary.";
      const actions = el("div", { class: "dfg-actions" });
      const proceed = el("button", { type: "button", class: "dfg-primary" });
      proceed.textContent = "Proceed with Reply all";
      const cancel = el("button", { type: "button" });
      cancel.textContent = "Cancel";
      actions.appendChild(proceed);
      actions.appendChild(cancel);
      card.appendChild(h4);
      card.appendChild(p);
      card.appendChild(actions);
      this.modal.appendChild(card);
      this.modal.classList.add("dfg-show");

      const cleanup = (v: boolean) => {
        this.modal.classList.remove("dfg-show");
        this.modal.textContent = "";
        resolve(v);
      };
      proceed.addEventListener("click", () => cleanup(true), { once: true });
      cancel.addEventListener("click", () => cleanup(false), { once: true });
      this.modal.addEventListener(
        "click",
        (e) => {
          if (e.target === this.modal) cleanup(false);
        },
        { once: true }
      );
    });
  }

  private renderPanel(): void {
    const s = this.state;
    this.panelBody.textContent = "";

    const sec1 = el("div");
    const row1 = el("div", { class: "dfg-row" });
    const k1 = el("div", { class: "dfg-k" });
    k1.textContent = "Interventions";
    const v1 = el("div", { class: "dfg-v" });
    v1.textContent = s ? `Effective: ${s.effective_state}` : "—";
    row1.appendChild(k1);
    row1.appendChild(v1);
    sec1.appendChild(row1);

    const evRow = el("div", { class: "dfg-row" });
    const evK = el("div", { class: "dfg-k" });
    evK.textContent = "Window events";
    const evV = el("div", { class: "dfg-v" });
    evV.textContent = s
      ? `${s.window_event_count}${s.last_event_type ? ` • last: ${s.last_event_type}` : ""}`
      : "—";
    evRow.appendChild(evK);
    evRow.appendChild(evV);
    sec1.appendChild(evRow);

    const whyRow = el("div", { class: "dfg-row" });
    const whyK = el("div", { class: "dfg-k" });
    whyK.textContent = "Why?";
    const whyV = el("div", { class: "dfg-v" });
    const tops = s?.model.top_contributors ?? [];
    if (tops.length === 0) whyV.textContent = "ML not ready yet.";
    else
      whyV.textContent = tops
        .map(
          (t) =>
            `${t.name.replaceAll("_", " ")} (${t.contribution >= 0 ? "+" : ""}${t.contribution.toFixed(2)})`
        )
        .join(", ");
    whyRow.appendChild(whyK);
    whyRow.appendChild(whyV);
    sec1.appendChild(whyRow);
    this.panelBody.appendChild(sec1);

    const sec2 = el("div");
    const actionsRow = el("div", { class: "dfg-row" });
    const k2 = el("div", { class: "dfg-k" });
    k2.textContent = "Model";
    const v2 = el("div", { class: "dfg-v" });
    v2.textContent = s
      ? `Samples: ${s.model.sample_count ?? 0}${s.model.trained_at ? ` • Trained ${fmtTime(s.model.trained_at)}` : ""}`
      : "—";
    actionsRow.appendChild(k2);
    actionsRow.appendChild(v2);
    sec2.appendChild(actionsRow);

    const buttons = el("div", { class: "dfg-actions" });
    const train = el("button", { type: "button", class: "dfg-primary" });
    train.textContent = s?.model.training ? "Training..." : "Train now";
    train.disabled = !!s?.model.training;
    train.addEventListener("click", () => this.handlers.onTrainNow());
    buttons.appendChild(train);

    const toggle = el("label", { class: "dfg-toggle" });
    const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
    cb.checked = this.overloaded;
    cb.addEventListener("change", () => {
      this.overloaded = cb.checked;
      this.handlers.onManualOverload(this.overloaded);
    });
    const txt = el("span");
    txt.textContent = "I feel overloaded";
    toggle.appendChild(cb);
    toggle.appendChild(txt);
    this.panelBody.appendChild(sec2);
    this.panelBody.appendChild(buttons);
    this.panelBody.appendChild(toggle);

    const sec3 = el("div");
    const devRow = el("div", { class: "dfg-row" });
    const devK = el("div", { class: "dfg-k" });
    devK.textContent = "Dev mode";
    const devV = el("div", { class: "dfg-v" });
    const devToggle = el("label", { class: "dfg-toggle" });
    const devCb = el("input", { type: "checkbox" }) as HTMLInputElement;
    devCb.checked = this.devMode;
    devCb.addEventListener("change", () => {
      this.devMode = devCb.checked;
      this.renderPanel();
    });
    const devTxt = el("span");
    devTxt.textContent = this.devMode ? "enabled" : "disabled";
    devToggle.appendChild(devCb);
    devToggle.appendChild(devTxt);
    devV.appendChild(devToggle);
    devRow.appendChild(devK);
    devRow.appendChild(devV);
    sec3.appendChild(devRow);
    this.panelBody.appendChild(sec3);

    if (this.devMode) {
      const devButtons = el("div", { class: "dfg-actions" });
      const sim = el("button", { type: "button", class: "dfg-primary" });
      sim.textContent = "Simulate overload";
      sim.addEventListener("click", () => this.handlers.onSimulateOverload());
      const reset = el("button", { type: "button" });
      reset.textContent = "Reset data";
      reset.addEventListener("click", () => this.handlers.onClearAll());
      devButtons.appendChild(sim);
      devButtons.appendChild(reset);
      this.panelBody.appendChild(devButtons);
    }

    const sec4 = el("div");
    const inboxRow = el("div", { class: "dfg-row" });
    const inboxK = el("div", { class: "dfg-k" });
    inboxK.textContent = "Decision Inbox";
    const inboxV = el("div", { class: "dfg-v" });
    inboxV.textContent = `${this.deferred.length} deferred`;
    inboxRow.appendChild(inboxK);
    inboxRow.appendChild(inboxV);
    sec4.appendChild(inboxRow);

    if (this.deferred.length === 0) {
      const empty = el("div", { class: "dfg-v" });
      empty.style.padding = "8px 0 2px";
      empty.textContent = "No deferred threads yet. Use “Decide later” in a thread.";
      sec4.appendChild(empty);
    } else {
      for (const d of this.deferred.slice(0, 25)) {
        const r = el("div", { class: "dfg-row" });
        const left = el("div");
        const k = el("div", { class: "dfg-k" });
        k.textContent = d.hash.replace(/^#/, "").slice(0, 36);
        const v = el("div", { class: "dfg-v" });
        v.textContent = `${fmtTime(d.ts)} • ${d.source}`;
        left.appendChild(k);
        left.appendChild(v);
        const right = el("div", { class: "dfg-actions" });
        const open = el("button", { type: "button", class: "dfg-primary" });
        open.textContent = "Open";
        open.addEventListener("click", () => this.handlers.onOpenDeferred(d.hash));
        const rm = el("button", { type: "button" });
        rm.textContent = "Remove";
        rm.addEventListener("click", () => this.handlers.onRemoveDeferred(d.hash));
        right.appendChild(open);
        right.appendChild(rm);
        r.appendChild(left);
        r.appendChild(right);
        sec4.appendChild(r);
      }
    }
    this.panelBody.appendChild(sec4);
  }
}
