# Decision Fatigue Guard (Chrome Extension MVP)

Privacy-first Chrome Extension (Manifest V3) that runs on Gmail (`mail.google.com`) and demonstrates:
- Real-time **Decision Load Score (DLS)** (0–100) with GREEN/AMBER/RED states
- **UI interventions** that visibly change Gmail as DLS rises
- An **on-device ML model** (TensorFlow.js logistic regression) that predicts overload risk from interaction metadata

No backend. No content scraping. No network requests.

## Prerequisites
- Node.js 18+ (recommended 20+)
- Google Chrome (MV3)

## Install
```bash
npm install
```

## Build
```bash
npm run build
```

This produces `dist/` (the unpacked extension folder).

## Load unpacked extension
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Demo steps (fast path)
1. Open Gmail: `https://mail.google.com/`
2. In the top-right, you’ll see a small **DLS pill** overlay.
3. Open the slide-out panel (gear icon) and enable **Dev Mode**.
4. Click **Simulate overload** a few times:
   - You should see Gmail UI simplify as state moves **GREEN → AMBER → RED**
   - In RED, “Reply all” is guarded by a confirm prompt in our overlay
5. Click **Decide later** in a thread view to add it to **Decision Inbox** (stored locally).
6. After you generate ~200+ events (or click **Train now**), ML will train locally and show **Risk**.

## What data is captured (metadata only)
Only interaction metadata is captured and stored locally in `chrome.storage.local`, including:
- thread open/close (from URL hash + view heuristics)
- button clicks like archive/delete/reply/reply-all/forward (by `aria-label` / role)
- indecision time (hover/scroll without “decision” actions)
- undo clicks (snackbar)
- context switching (visibility/blur/focus)
- time-to-first-action per thread (measured from open to first action)

We do **not** read or store email subject, body, recipients, or message content.

## Project structure
```
public/
  manifest.json
  icons/
src/
  content/
    gmailObserver.ts
    eventCapture.ts
    uiOverlay.ts
    interventions.ts
    styles.css
    index.ts
  background/
    service_worker.ts
    model.ts
    storage.ts
  shared/
    types.ts
    dls.ts
    featureEngineering.ts
tests/
  dls.test.ts
  featureEngineering.test.ts
```

## Notes / limitations (MVP)
- Gmail DOM changes frequently; this uses resilient heuristics + MutationObserver, but Gmail may still break it in edge cases.
- Interventions are additive/reversible: CSS/handlers are attached via our overlay and removed when disabled.

