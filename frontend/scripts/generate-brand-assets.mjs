// Regenerates the source artwork capacitor-assets turns into every icon/splash size:
//   node scripts/generate-brand-assets.mjs && bun run cap:assets
// Drawn from the same mark as public/favicon.svg. Replace assets/*.png with
// final brand artwork at any time; this script is only the starting point.
import sharp from "sharp";

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#28528e"/><stop offset="100%" stop-color="#3d64c7"/></linearGradient></defs>`;
// The bars/trend mark on a 1024 canvas; `scale` shrinks it toward the centre (adaptive icons need it inside the 66% safe zone).
const mark = (scale = 1) => `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)" stroke="#fcfcfc" stroke-linecap="round" fill="none">
  <g stroke-width="56"><path d="M282 704V536"/><path d="M512 704V410"/><path d="M742 704V294"/></g>
  <path d="M243 398 410 486l128-154 166 77" stroke-opacity="0.55" stroke-width="42" stroke-linejoin="round"/></g>`;
const svg = (body, w = 1024, h = 1024, vb = "0 0 1024 1024") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`);

const png = (name, buf) => sharp(buf).png().toFile(`assets/${name}`);

await png("icon-only.png", svg(`${gradient}<rect width="1024" height="1024" fill="url(#g)"/>${mark(1)}`));
await png("icon-background.png", svg(`${gradient}<rect width="1024" height="1024" fill="url(#g)"/>`));
await png("icon-foreground.png", svg(mark(0.78)));

const splash = (bg) => svg(`<rect width="2732" height="2732" fill="${bg}"/><g transform="translate(766 766) scale(1.2)">${`<rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#g)"/>${mark(1)}`}</g>${gradient}`, 2732, 2732, "0 0 2732 2732");
await png("splash.png", splash("#ffffff"));
await png("splash-dark.png", splash("#0b1220"));
console.log("wrote assets/icon-only.png icon-foreground.png icon-background.png splash.png splash-dark.png");
