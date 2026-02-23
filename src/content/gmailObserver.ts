export type GmailView =
  | { kind: "inbox"; hash: string }
  | { kind: "thread"; hash: string; threadId: string };

function normalizeHash(h: string): string {
  if (!h) return "#";
  return h.startsWith("#") ? h : `#${h}`;
}

function parseThreadId(hash: string): string | null {
  const clean = normalizeHash(hash).slice(1).split("?")[0] ?? "";
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];
  if (!last) return null;
  if (last.length < 6) return null;
  if (last === "compose" || last === "search") return null;
  return last;
}

function domLooksLikeThread(): boolean {
  return (
    document.querySelector('[aria-label="Back to Inbox"]') != null ||
    document.querySelector('[data-tooltip="Back to Inbox"]') != null
  );
}

function computeView(): GmailView {
  const hash = normalizeHash(location.hash);
  const threadId = parseThreadId(hash);
  const isThread = threadId != null && (domLooksLikeThread() || hash.includes("/"));
  if (isThread && threadId) return { kind: "thread", hash, threadId };
  return { kind: "inbox", hash };
}

export function startGmailObserver(onView: (view: GmailView) => void): () => void {
  let lastHash = "";
  let lastKind: GmailView["kind"] | null = null;
  let raf = 0;

  const emit = () => {
    const view = computeView();
    if (view.hash !== lastHash || view.kind !== lastKind) {
      lastHash = view.hash;
      lastKind = view.kind;
      onView(view);
    }
  };

  const schedule = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(emit);
  };

  const obs = new MutationObserver(() => schedule());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("hashchange", schedule, { passive: true });

  const poll = window.setInterval(() => {
    if (location.hash !== lastHash) schedule();
  }, 500);

  emit();
  return () => {
    obs.disconnect();
    window.removeEventListener("hashchange", schedule);
    window.clearInterval(poll);
    if (raf) cancelAnimationFrame(raf);
  };
}

