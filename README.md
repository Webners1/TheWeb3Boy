# theweb3boy

Personal brand site for Muzammil (theweb3boy) — a Web3 builder and AI engineer.
Built with Next.js (App Router), TypeScript, and a hand-written WebGL/Three.js
hero shader. No CSS framework — the design system lives in `src/app/globals.css`.

This repo is the **frontend only**. It does not contain the youVsBTC backend
(ingestion, NAV computation, database) — that lives in a separate, private
codebase. The dashboard at `/dashboard` calls the live Railway API configured
by `NEXT_PUBLIC_VAULTBENCH_URL`. Its origin must be allowed by the API's CORS
configuration. Records carry their own dates and coverage; the list is not a
common-date ranking. Turning off "Full window only" enables exploration of
partial and excluded records.

## Structure

```
src/app/            Routes: / (homepage), /dashboard (youVsBTC dashboard)
src/app/globals.css Design system: colors, type, layout, all component styles
src/lib/            Client-side effects: hero shader, duel chart, nav/contact/ticker
public/hero.jpg     Hero background photo
```

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run start
```

## Notes

- The hero shader is a hand-written GLSL fragment shader run through Three.js
  (`src/lib/heroEffects.ts`): it renders the hero photo as a texture, applies
  a cursor-following magnifying lens plus a subtle ripple/chromatic-aberration
  distortion, and resolves the photo out of noise on first load.
- Hotspot regions (`.hotspot` divs in `src/app/page.tsx`) are positioned from
  hand-measured coordinates on the source photo (`data-uleft` / `data-uright`
  / `data-vtop` / `data-vbottom`, as fractions of the 1500x500 image). Nudge
  those values directly if a label doesn't line up with the real object.
- Everything respects `prefers-reduced-motion` and pauses off-screen /
  backgrounded rendering for performance.
