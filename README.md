# The Practice App — standalone web version

A golf practice tracker with real strokes-gained analysis, ported out of Claude into a
self-contained web app. All data is stored locally in the browser (IndexedDB), scoped per
profile — nothing is sent to a server, and there's no cross-device sync by design.

## What's in here

- `src/App.jsx` — the full app (Range, Short Game, Putting, Analysis, Settings). This is the
  same code that ran as a Claude artifact, with only the storage layer and a small "Profile"
  section in Settings added.
- `src/storage.js` — replaces Claude's `window.storage` with an IndexedDB-backed equivalent,
  namespaced per profile. Also handles the Export/Import JSON backup feature.
- `src/ProfileGate.jsx` — the "who's playing?" screen shown before the app. Lets someone pick
  an existing local profile or create a new one; each profile's data is kept separate.
- `vite.config.js` — configured with `vite-plugin-pwa` so the built app is installable to a
  home screen and works fully offline.
- `public/icon-192.png` / `icon-512.png` — placeholder app icons (a simple flag-in-hole mark).
  Swap these for real artwork before shipping anywhere public.

## Local development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Hot-reloads on save.

## Build for production

```bash
npm run build
npm run preview   # serves the production build locally to sanity-check it
```

Output lands in `dist/` — a fully static site, no server required.

## Deploying

Since there's no backend, any static host works. The easiest options:

1. **Vercel** — `npm i -g vercel`, then `vercel` from this folder, or connect the GitHub repo
   in the Vercel dashboard for auto-deploy on push.
2. **Netlify** — drag-and-drop the `dist/` folder into the Netlify dashboard, or connect the
   repo for git-based deploys. Build command: `npm run build`, publish directory: `dist`.
3. **Cloudflare Pages** — same idea: connect the repo, build command `npm run build`, output
   directory `dist`.

All three have free tiers that comfortably cover this.

## What you need to sign up for

- **GitHub** (free) — to host the code and enable git-push-to-deploy. Not strictly required
  (you can drag-and-drop a build to Netlify without it), but makes updates much easier.
- **One hosting provider** (free tier) — Vercel, Netlify, or Cloudflare Pages. Pick one.
- **A domain registrar** (optional, paid) — only if you want a custom domain instead of the
  free `yourapp.vercel.app`-style subdomain. Namecheap, Cloudflare Registrar, or Google
  Domains/Squarespace are common choices.

That's the whole list — no database provider, no auth service, no email service, since the
app never talks to a server.

## Known limitations of this architecture

- **No cross-device sync.** A profile's data lives only in that browser's IndexedDB. Opening
  the app on a different device or browser starts fresh, even under the "same" profile name.
- **Browser storage isn't permanent.** iOS Safari in particular can evict site data that
  hasn't been used in a while, and clearing browser data wipes everything. Encourage regular
  use of **Settings → Export Data** as a backup — it downloads a JSON file per profile that
  can be re-imported with **Import Data**.
- **`crypto.randomUUID()`** (used to generate profile IDs) needs a reasonably modern browser
  (Chrome 92+, Safari 15.4+, Firefox 95+). Fine for essentially all real-world mobile usage
  today, but worth knowing if you need to support very old devices.
