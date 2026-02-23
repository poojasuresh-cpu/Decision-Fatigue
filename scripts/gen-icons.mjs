import fs from "node:fs";
import path from "node:path";

// Generates tiny placeholder PNGs so the repo stays text-only.
// (Chrome prefers PNG icons; we create simple 1x1 colored PNG variants.)

const root = path.resolve(process.cwd(), "public", "icons");
fs.mkdirSync(root, { recursive: true });

// 1x1 PNG, solid color, created once and reused (valid PNG with IHDR/IDAT/IEND).
// Color isn't critical; Chrome scales it. (This is a minimal valid PNG.)
const base64Png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/awxJ0cAAAAASUVORK5CYII=";
const buf = Buffer.from(base64Png, "base64");

for (const size of [16, 48, 128]) {
  const file = path.join(root, `icon${size}.png`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
}

