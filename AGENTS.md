<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# AGENTS.md — LuckyLab Demo Workspace Rules
<!--
  This file is intentionally free-form. The workspace rules mechanism loads it
  as the project-level contract for *any* AI agent editing this repo. Keep it
  authoritative, short, and cross-referenced to actual source files so the
  agent can verify every rule against reality.
-->

## 0. Stack & Style Contract
- **Runtime**: Next.js **16.3.0** (App Router) in **SSR mode** — deployed to EdgeOne Pages via its Next.js framework adapter ([edgeone.json](edgeone.json): `outputDirectory: ".next"`). The Next.js server runs at the edge, so `proxy.ts`, server components, and prerendered routes are all available. React **19.2.8** · TypeScript · next-intl · **Clerk auth** (`@clerk/nextjs`, keys in `.env.local`) · **no Tailwind** (plain hand-written CSS + CSS variables).
- **Two server layers**: (a) the **Next.js layer** ([proxy.ts](proxy.ts) + server components) owns routing, auth session refresh, locale negotiation, and page rendering; (b) **EdgeOne Pages Edge Functions** under [functions/](functions/) own the KV-backed HTTP APIs (`/api/presence`, `/api/counter`, `/api/echo`, `/api/headers`). Do not move KV logic into `app/api/**` Route Handlers — the edge functions are the KV integration point (§5).
- **UI flavour**: **Neo-Brutalism**. Hard 3px borders, solid offset `box-shadow` (2-4px displacement, NO blur drop-shadows anywhere on structural cards/buttons/dock), #ea580c orange accent, Inter for body, JetBrains Mono fallback for `<code>`-style labels.
- **Nav UX**: **Morphing Slab** nav ([Nav.tsx](app/[locale]/components/Nav.tsx)). Invariants: the header is a *constant* full-width plate in every scroll position — it never morphs into a floating capsule; scrolling past 24px only tightens it and fills a progress rule (`header[data-scrolled]`, via [useDockMode.ts](app/[locale]/components/nav/useDockMode.ts)). Press physics ([useDockPress.ts](app/[locale]/components/nav/useDockPress.ts)): every pointer frame mutates styles inside a single `rAF` loop (zero React renders per frame) and feeds an under-damped spring shared with keyboard focus; `prefers-reduced-motion` and non-fine pointers disable motion entirely. Exact tuning constants live in the source — treat them as the documented "feel", not as free parameters. Auth controls in the dock ([Nav.tsx](app/[locale]/components/Nav.tsx)): `<Show when="signed-out">` renders `SignInButton`/`SignUpButton` (modal mode), `<Show when="signed-in">` renders `UserButton` — Clerk v7 removed `SignedIn`/`SignedOut`; use `Show`.
- **Locale routing**: [i18n/routing.ts](i18n/routing.ts) uses `localePrefix: "always"` — every URL is `/zh/…` or `/en/…` with a trailing slash. Unprefixed paths (including `/`) are locale-negotiated by `intlMiddleware` inside [proxy.ts](proxy.ts): `NEXT_LOCALE` cookie → `Accept-Language` weights → default `zh`, answered with a redirect (never cached).
- **Zero-runtime motion & icons**: no framer-motion / lucide-react or similar runtime dependencies — animations are hand-written CSS keyframes, icons are inline SVGs (24-grid, `stroke="currentColor"`, `aria-hidden`). Bundle weight is a design constraint: check the `npm run build` chunk table when touching client components.

## 1. HARD CONSTRAINTS — do not violate
1. **Hybrid architecture — keep the layers separate.** `proxy.ts` is the single composition point for request-time middleware: `clerkMiddleware` wraps `intlMiddleware` (in that order), and its `config.matcher` must keep all three segments — the static-file exclusion regex, `"/(api|trpc)(.*)"`, and `'/__clerk/:path*'` (Clerk auto-proxy, always last). **KV-backed API endpoints live in `functions/` (§5), not `app/api/**`** — do not recreate them as Route Handlers. `dynamic = "force-dynamic"` is allowed only where genuinely required (auth-dependent pages render via `<Show>` on the client instead; prefer static/prerendered output whenever possible).
2. **`app/**/*.ts(x)` keeps Chinese out of code** — string literals, JSX text nodes and identifiers must be CJK-free. Chinese **is allowed in comments** (`//`, `/* */`, JSDoc) for readability. Enforcement scope: `tests/i18n.test.ts` scans `app/` only and exempts `app/[locale]/blog/**` (standalone article content, not i18n UI copy). Outside `app/` there is no restriction (`messages/*.json`, `app/styles/*.css`, `functions/`, E2E scripts). Mechanism: comments are stripped via `ts.transpileModule({ removeComments: true })` (JSX preserved) before scanning, so only real code content is checked.
3. **User-facing strings & ARIA labels always go through next-intl** (`useTranslations`, `getTranslations`). Literal `aria-label="…"` with human words in TSX → failing test. Exceptions: machine-only attributes (`aria-current="page"`, `data-*`, CSS class names).
4. **Theme init script is server-rendered by the root layout — and nowhere else.** [layout.tsx](app/[locale]/layout.tsx) renders `<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />` inside `<head>` (Next.js official preventing-flash-before-hydration pattern; source of the string: [app/lib/theme.ts](app/lib/theme.ts)). The layout is the **only** component in `app/` allowed to render a `<script>` node — any other occurrence fails `tests/theme-i18n.test.ts`. `<html>` keeps `suppressHydrationWarning` because the script sets `data-theme` before hydration. React never warns about it: the warning only fires for script nodes produced by *client* renders, and the layout is a server component.
5. **`@swc/helpers` pinned to `0.5.17`** via `package.json` → `"overrides"`. Bump only when you've verified both `next build --webpack` and `next dev --turbopack` still compile the App Router.

## 2. CSS Rules (Neo-Brutalism invariants)
- Keep every surface under a single family of variables in [globals.css](app/globals.css) / [tokens.css](app/styles/tokens.css): `--color-border`, `--color-surface`, `--shadow-sm/lg/primary`, `--radius-sm/md/lg`.
- Blurred `box-shadow` is **disallowed** on UI elements. Depth is always a solid, displaced border-colored pixel block — `2px 2px 0 0 var(--color-border)` and its relatives. If you want lift, grow the *displacement*.
- Containers are fluid with clamp()-scaled gutters — `.container` / `.footer-container` use `padding-inline: clamp(var(--space-md), 4vw, var(--space-2xl))`. `.container` is additionally center-capped at `max-width: 100rem; margin-inline: auto` so ultra-wide (2K/4K) displays keep generous side margins; do not shrink that cap. Breakpoints are `880px` (brand collapses → single-letter mark) and `640px` (dock becomes scrollable rail). Respect them when adding new navigation chrome.
- Do **not** re-introduce Tailwind. The project intentionally ships 0 CSS-in-JS / utility-class runtime.

## 3. Anti-FOUC Theme Script — SSR CONTRACT
The theme init script must execute during HTML parsing, **before first paint**, to set `data-theme` and avoid a light/dark flash. The approved mechanism changed with the SSR migration:

1. **Single source of truth**: `themeInitScript()` lives in [app/lib/theme.ts](app/lib/theme.ts) (self-contained ES5 string, no imports).
2. **Server-rendered inline in `<head>`**: the root layout is a server component; its `<script dangerouslySetInnerHTML>` output executes synchronously during HTML parse and never enters the client React tree. Do **not** switch to `next/script` (`strategy="beforeInteractive"` still creates a client-side VDOM script node and triggers the React 19 warning on client navigations) and do **not** use `<template>` (inert content does not auto-run).
3. **The layout is the only `<script>` renderer** in `app/` — enforced by `tests/theme-i18n.test.ts`, which also fails if the build-time injector ([scripts/inject-theme.mjs](scripts/inject-theme.mjs), retired with the static export) ever reappears.
4. `suppressHydrationWarning` on `<html>` exists solely to swallow the `data-theme` attribute mismatch caused by the pre-hydration script; it is unrelated to script elements.

## 4. Quality Gates (must all be green before any push)
```bash
npm test     # vitest run — grep contracts + unit tests (incl. tests/functions.test.ts)
npm run lint # eslint . via eslint.config.mjs — TS rules enabled
npm run build  # next build --webpack
```
- **Build guard**: the build must complete and register the proxy (`ƒ Proxy (Middleware)` in the route table). `.env.local` (Clerk keys) is loaded automatically in dev/build — never commit it.
- **Edge-function contract**: pure logic in `functions/*.js` is exported and pinned by `tests/functions.test.ts` (`sessionKey`/`countOnline`, `isFresh`/`buildStarsPayload`, `extractClientIp`). Changing an exported signature requires updating that test in the same commit. Each function file stays **self-contained** (no cross-imports between functions) — a shared module would be a design decision.
- `e2e-cross-feature.cjs` is a cross-feature matrix (i18n × theme) run **manually** against a dev/preview server — it is not part of `npm test`. All URLs use the `/zh/` + `/en/` prefixed, trailing-slash form. When you rename container CSS classes (e.g. `.nav-links` → `.dock-nav`), update its `document.querySelector(...)` lines in the same commit.
- Any new tool-logic function added to `app/[locale]/tools/**/*.ts` must ship a sibling `*.test.ts` — `tests/tools.test.ts` is for shared helpers, not per-tool cases.

## 5. Edge Functions & Storage (EdgeOne Pages) — BEST PRACTICES
- **Deploy model**: [edgeone.json](edgeone.json) sets `buildCommand`/`outputDirectory` for the Next.js SSR adapter; the `functions/` directory deploys alongside the app. On EdgeOne Pages a request **matches edge-function routes first**, then falls back to the Next.js server — so `/api/presence` and friends are served by edge functions, while every page route goes through `proxy.ts` and SSR/prerendered rendering.
- **Runtime is the edge JS runtime, not Node**: Web-standard APIs only (`fetch`, `Request`/`Response`, `URL`, `crypto`); no Node built-ins, no filesystem, no `/tmp` persistence. Keep handlers thin; export the pure logic for `tests/functions.test.ts`.
- **The functions**:
  - [functions/api/presence.js](functions/api/presence.js) → real-time online count (KV). POST = heartbeat + lazy sweep, GET = read-only snapshot.
  - [functions/api/counter.js](functions/api/counter.js) → sign-in-only real-time counter (KV). Per-user key `counter_user_<uid>`; GET = read-only snapshot `{ total, users, mine }`, POST = verify Clerk session → read-modify-write +1. Both verbs reject unauthenticated calls with 401.
  - [functions/api/echo.js](functions/api/echo.js) · [functions/api/headers.js](functions/api/headers.js) → debug endpoints for the http-check tool (never cached).
  - There is **no** `functions/index.js`: root-path locale negotiation moved into `proxy.ts` (`intlMiddleware`). Do not re-add a `/` edge function — it would shadow the Next.js layer.
- **KV best practices** (the namespace is bound in the EdgeOne console with the variable name `DICTIONARY`; per the official semantics (docs + `functions-kv` template) it is injected as a **bare edge-function global identifier**, NOT on `context.env` — `getKv()` reads it via a `typeof`-guarded bare identifier with a `globalThis` fallback):
  - Keys accept **only `[A-Za-z0-9_]`** (≤512B) — normalize all user-derived input (see `sessionKey()`). Values are strings ≤25MB.
  - **No TTL and no atomic INCR**: expiry is decided at the application layer (presence: 45s heartbeat window), and counters are computed via `list({ prefix })` + per-key `get` (see `countOnline`) — inherently approximate. KV is **eventually consistent (~60s global propagation)**: UI copy must not promise exactness.
  - `list()` is the only key-discovery API and caps at 256 keys per page (`cursor` for more; each `keys` entry is a `ListKey` object whose field is **`key`** — `class ListKey { key: String }`, NOT `name`). Deletes of stale keys piggyback on write-path requests (lazy sweep) — there is no background job.
  - KV is callable **only from Edge Functions**. Unbound/unavailable KV must degrade gracefully: presence and counter both answer `503 {error:"kv-not-configured"|"kv-unavailable"}` (the counter UI keeps its last reading / offers a retry instead of crashing).
- **Caching**: every API/function response is `cache-control: no-store`. **No HTML edge caching**: pages now contain auth-state UI, so per-route `s-maxage` headers and unprefixed `redirects` were removed from [edgeone.json](edgeone.json) — do not re-add them (cross-user cache leak). Only two headers remain: `/_next/static/*` → immutable, `/feed.xml` → `s-maxage=3600`.
- The blog like/reactions feature was **removed by design** — do not resurrect `/api/reactions`, `reaction-store`, or `PostReactions`.

## 6. What to delete / not to create
- **Never commit per-session AI scratch pads**: `BRANDING.md`, `CLAUDE.md`, `DIAGNOSTIC_REPORT.md`, `QA_REPORT.md` and similar one-off audit docs must not live in the repo root. They were snapshots of specific sessions. Preserve *rules* in this file (`AGENTS.md`), preserve *tests* in `tests/`, and drop everything else.
- **Do not proactively create `*.md` docs** unless the user requests them. The only hand-maintained project-level doc that must exist is this file plus `README.md` (for humans cloning the repo). Everything else is source or tests.

## 7. Quick-reference file map
| Concern | Location |
|---|---|
| Root layout / metadata / ClerkProvider / theme script in `<head>` | [app/[locale]/layout.tsx](app/[locale]/layout.tsx) |
| Proxy (clerkMiddleware × intlMiddleware composition + matcher) | [proxy.ts](proxy.ts) |
| Morphing Slab nav + auth controls (`Show`, SignIn/SignUp/UserButton) | [app/[locale]/components/Nav.tsx](app/[locale]/components/Nav.tsx) |
| Theme runtime helpers (apply/persist/resolve) + `themeInitScript()` | [app/lib/theme.ts](app/lib/theme.ts) |
| CSS variables + component classes + dock shell (incl. `.dock-auth-btn`) | [app/globals.css](app/globals.css) + [app/styles/](app/styles/) |
| i18n locale routing (`localePrefix: "always"`) | [i18n/routing.ts](i18n/routing.ts) |
| i18n locale catalogues | [messages/zh.json](messages/zh.json) · [messages/en.json](messages/en.json) |
| i18n link primitives / request config | [i18n/navigation.ts](i18n/navigation.ts) · [i18n/request.ts](i18n/request.ts) |
| Clerk keys (never commit) | `.env.local` |
| Clerk component theming (`clerkAppearance` + `auth-*` classes) | `app/[locale]/layout.tsx` + [app/styles/clerk.css](app/styles/clerk.css) |
| Presence heartbeat (online count, KV) | [functions/api/presence.js](functions/api/presence.js) + [Presence.tsx](app/[locale]/components/Presence.tsx) |
| Real-time counter (sign-in-gated, KV) | [functions/api/counter.js](functions/api/counter.js) + [CounterClient.tsx](app/[locale]/tools/counter/CounterClient.tsx) |
| http-check debug endpoints | [functions/api/echo.js](functions/api/echo.js) · [functions/api/headers.js](functions/api/headers.js) |
| Edge-function unit tests (fake KV, pure logic) | [tests/functions.test.ts](tests/functions.test.ts) |
| RSS feed route | [app/feed.xml/route.ts](app/feed.xml/route.ts) |
| EdgeOne deploy config (SSR output dir, static-cache headers) | [edgeone.json](edgeone.json) |
| Test suite (grep contracts + unit) | [tests/](tests/) |
| Cross-feature zh/en × light/dark E2E script (manual) | [scripts/e2e-cross-feature.cjs](scripts/e2e-cross-feature.cjs) |
