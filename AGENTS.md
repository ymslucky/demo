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
- **Runtime**: Next.js **16.3.0** (App Router) in **pure static-export mode** — `next.config.ts` sets `output: "export"` (+ `trailingSlash: true`, `images.unoptimized`) and the build emits `out/`. **There is no Next.js server at runtime**: no middleware/proxy, no Node Route Handlers, no ISR. All dynamic behavior lives in **EdgeOne Pages Edge Functions** under [functions/](functions/). React **19.2.8** · TypeScript · next-intl · **no Tailwind** (plain hand-written CSS + CSS variables).
- **UI flavour**: **Neo-Brutalism**. Hard 3px borders, solid offset `box-shadow` (2-4px displacement, NO blur drop-shadows anywhere on structural cards/buttons/dock), #ea580c orange accent, Inter for body, JetBrains Mono fallback for `<code>`-style labels.
- **Nav UX**: **Morphing Slab** nav ([Nav.tsx](app/[locale]/components/Nav.tsx)). Invariants: the header is a *constant* full-width plate in every scroll position — it never morphs into a floating capsule; scrolling past 24px only tightens it and fills a progress rule (`header[data-scrolled]`, via [useDockMode.ts](app/[locale]/components/nav/useDockMode.ts)). Press physics ([useDockPress.ts](app/[locale]/components/nav/useDockPress.ts)): every pointer frame mutates styles inside a single `rAF` loop (zero React renders per frame) and feeds an under-damped spring shared with keyboard focus; `prefers-reduced-motion` and non-fine pointers disable motion entirely. Exact tuning constants live in the source — treat them as the documented "feel", not as free parameters.
- **Locale routing**: [i18n/routing.ts](i18n/routing.ts) uses `localePrefix: "always"` — every URL is `/zh/…` or `/en/…` with a trailing slash. Static export cannot keep the default locale at the root (no rewrites exist in `out/`), so `/` is served by [functions/index.js](functions/index.js): `NEXT_LOCALE` cookie → `Accept-Language` weights → default `zh`, answered with a **302** (never cached). `setRequestLocale(locale)` is still called in [layout.tsx](app/[locale]/layout.tsx) so every page exports statically.
- **Zero-runtime motion & icons**: no framer-motion / lucide-react or similar runtime dependencies — animations are hand-written CSS keyframes, icons are inline SVGs (24-grid, `stroke="currentColor"`, `aria-hidden`). Bundle weight is a design constraint: check the `npm run build` chunk table when touching client components.

## 1. HARD CONSTRAINTS — do not violate
1. **Static export only — no Next.js server code paths.** Do not re-add `middleware.ts`/`proxy.ts`, `app/api/**` Route Handlers, `dynamic = "force-dynamic"`, rewrites, or anything `next build` cannot export to `out/`. Server behavior belongs in `functions/` (EdgeOne Edge Functions, §5). The `middleware` deprecation topic is moot here: the file was deleted on purpose.
2. **`app/**/*.ts(x)` keeps Chinese out of code** — string literals, JSX text nodes and identifiers must be CJK-free. Chinese **is allowed in comments** (`//`, `/* */`, JSDoc) for readability. Enforcement scope: `tests/i18n.test.ts` scans `app/` only and exempts `app/[locale]/blog/**` (standalone article content, not i18n UI copy). Outside `app/` there is no restriction (`messages/*.json`, `app/styles/*.css`, `functions/`, E2E scripts). Mechanism: comments are stripped via `ts.transpileModule({ removeComments: true })` (JSX preserved) before scanning, so only real code content is checked.
3. **User-facing strings & ARIA labels always go through next-intl** (`useTranslations`, `getTranslations`). Literal `aria-label="…"` with human words in TSX → failing test. Exceptions: machine-only attributes (`aria-current="page"`, `data-*`, CSS class names).
4. **Theme init is build-time injected, never a React `<script>` node**: [scripts/inject-theme.mjs](scripts/inject-theme.mjs) is the single source of `themeInitScript()` and splices it right after `<head>` in every `out/**/*.html` (`npm run build` runs it automatically after `next build`). [layout.tsx](app/[locale]/layout.tsx) keeps `suppressHydrationWarning` on `<html>` (the script sets `data-theme` before hydration) and must contain **no** `<script>` JSX at all. Enforced by `tests/theme-i18n.test.ts` + `tests/theme.test.ts`; rationale in §3.
5. **`@swc/helpers` pinned to `0.5.17`** via `package.json` → `"overrides"`. Bump only when you've verified both `next build --webpack` and `next dev --turbopack` still compile the App Router.

## 2. CSS Rules (Neo-Brutalism invariants)
- Keep every surface under a single family of variables in [globals.css](app/globals.css) / [tokens.css](app/styles/tokens.css): `--color-border`, `--color-surface`, `--shadow-sm/lg/primary`, `--radius-sm/md/lg`.
- Blurred `box-shadow` is **disallowed** on UI elements. Depth is always a solid, displaced border-colored pixel block — `2px 2px 0 0 var(--color-border)` and its relatives. If you want lift, grow the *displacement*.
- Containers are fluid with clamp()-scaled gutters — `.container` / `.footer-container` use `padding-inline: clamp(var(--space-md), 4vw, var(--space-2xl))`. `.container` is additionally center-capped at `max-width: 100rem; margin-inline: auto` so ultra-wide (2K/4K) displays keep generous side margins; do not shrink that cap. Breakpoints are `880px` (brand collapses → single-letter mark) and `640px` (dock becomes scrollable rail). Respect them when adding new navigation chrome.
- Do **not** re-introduce Tailwind. The project intentionally ships 0 CSS-in-JS / utility-class runtime.

## 3. Anti-FOUC Script Injection — BUILD-TIME WORKFLOW
React 19 emits a console warning **every time** a *client* render produces a `<script>` VDOM node ("Encountered a script tag while rendering a React component…"). It fires on *every* client-side navigation (e.g. zh ⇄ en language toggle) because the root layout re-renders in the browser. **`next/script` + `strategy="beforeInteractive"` does NOT prevent the warning**; the JSX still creates the VDOM node.

### Approved pattern (used for the `themeInitScript()` anti-FOUC script):
1. **Single source of truth**: `themeInitScript()` lives only in [scripts/inject-theme.mjs](scripts/inject-theme.mjs) — a self-contained ES5 string (no imports). `app/lib/theme.ts` deliberately does **not** export it anymore.
2. **Injection happens after the build, not in React.** `npm run build` = `next build --webpack && node scripts/inject-theme.mjs`. The injector walks `out/`, and for each HTML file splices `<script>${themeInitScript()}</script>` right after `<head>` (fallbacks: after `<body…>`, then doc start). Injection is **idempotent** — re-running never duplicates the script. React never sees the element.
3. **Never render the script from a component.** The layout renders zero `<script>` JSX, and `tests/theme-i18n.test.ts` fails if one reappears. The `suppressHydrationWarning` on `<html>` suppresses the `data-theme` attribute mismatch caused by setting the attribute before hydration — it is unrelated to the script element itself.
4. Ignore the warning's suggestion to use `<template>` — template content is inert and inline JS inside one does NOT auto-run on parse; it is a generic hint, not a fix for this case.
5. The invariant is "the script exists in served HTML **before** React parses it, and never in the React tree". If EdgeOne ever grows an HTML-rewrite edge hook we actually need, the same string transform may move there; until then the build-time injector is the only approved mechanism.

## 4. Quality Gates (must all be green before any push)
```bash
npm test     # vitest run — grep contracts + unit tests (incl. tests/functions.test.ts)
npm run lint # eslint . via eslint.config.mjs — TS rules enabled
npm run build  # next build --webpack && node scripts/inject-theme.mjs
```
- **Static-export guard**: the build must complete with **every page route Static/SSG** and emit `out/`; the trailing inject-theme step must report **all** HTML files updated (a smaller count means injection silently skipped files — investigate). No `app/api/**` directory may reappear.
- **Edge-function contract**: pure logic in `functions/*.js` is exported and pinned by `tests/functions.test.ts` (`parseAcceptLanguage`/`pickLocale`, `sessionKey`/`countOnline`, `isFresh`/`buildStarsPayload`, `extractClientIp`). Changing an exported signature requires updating that test in the same commit. Each function file stays **self-contained** (no cross-imports between functions) — a shared module would be a design decision.
- `e2e-cross-feature.cjs` is a cross-feature matrix (i18n × theme) run **manually** against a dev/preview server — it is not part of `npm test`. All URLs use the `/zh/` + `/en/` prefixed, trailing-slash form. When you rename container CSS classes (e.g. `.nav-links` → `.dock-nav`), update its `document.querySelector(...)` lines in the same commit.
- Any new tool-logic function added to `app/[locale]/tools/**/*.ts` must ship a sibling `*.test.ts` — `tests/tools.test.ts` is for shared helpers, not per-tool cases.

## 5. Edge Functions & Storage (EdgeOne Pages) — BEST PRACTICES
- **Deploy model**: [edgeone.json](edgeone.json) declares `outputDirectory: "out"`; the `functions/` directory deploys alongside it. On EdgeOne Pages a request **matches function routes first**, then falls back to static files — so `functions/index.js` only ever sees `/`, and unmatched `/zh/**` paths hit static HTML with zero function invocations.
- **Runtime is the edge JS runtime, not Node**: Web-standard APIs only (`fetch`, `Request`/`Response`, `URL`, `crypto`); no Node built-ins, no filesystem, no `/tmp` persistence. Keep handlers thin; export the pure logic for `tests/functions.test.ts`.
- **The functions**:
  - [functions/index.js](functions/index.js) → `/` — language negotiation 302 (cookie → Accept-Language → `zh`); response is `no-store` because it depends on per-request headers.
  - [functions/api/presence.js](functions/api/presence.js) → real-time online count (KV). POST = heartbeat + lazy sweep, GET = read-only snapshot.
  - [functions/api/github/stars.js](functions/api/github/stars.js) → GitHub stars proxy with a single-key KV cache (`stars_cache_v1`, 1h freshness, stale-while-error fallback, 502 without any cache).
  - [functions/api/echo.js](functions/api/echo.js) · [functions/api/headers.js](functions/api/headers.js) → debug endpoints for the http-check tool (never cached).
- **KV best practices** (namespace must be bound in the EdgeOne console as `luckylab_kv`; code probes `context.env` **and** a global binding):
  - Keys accept **only `[A-Za-z0-9_]`** (≤512B) — normalize all user-derived input (see `sessionKey()`). Values are strings ≤25MB.
  - **No TTL and no atomic INCR**: expiry is decided at the application layer (presence: 45s heartbeat window), and counters are computed via `list({ prefix })` + per-key `get` (see `countOnline`) — inherently approximate. KV is **eventually consistent (~60s global propagation)**: UI copy must not promise exactness.
  - `list()` is the only key-discovery API and caps at 256 keys per page (`cursor` for more; `ListKey` field is `name`). Deletes of stale keys piggyback on write-path requests (lazy sweep) — there is no background job.
  - KV is callable **only from Edge Functions**. Unbound/unavailable KV must degrade gracefully: presence → `503 {error:"kv-not-configured"|"kv-unavailable"}`, stars → direct upstream fetch (cache-less mode).
- **Caching**: every API/function response is `cache-control: no-store`. HTML pages are enumerated per-route in [edgeone.json](edgeone.json) with `s-maxage=3600, stale-while-revalidate=86400` — the list is exhaustive **by design** (wildcard semantics unverified on EdgeOne): **adding a page route requires adding its zh + en header entries in the same commit**. Legacy unprefixed URLs (`/about`, `/blog/…`) 301-redirect via the same file's `redirects` (`{source, destination, permanent}`) — keep that list exhaustive too. Caching is safe because every HTML route is fully static and the injected theme script (§3) is content-constant.
- The blog like/reactions feature was **removed by design** — do not resurrect `/api/reactions`, `reaction-store`, or `PostReactions`.

## 6. What to delete / not to create
- **Never commit per-session AI scratch pads**: `BRANDING.md`, `CLAUDE.md`, `DIAGNOSTIC_REPORT.md`, `QA_REPORT.md` and similar one-off audit docs must not live in the repo root. They were snapshots of specific sessions. Preserve *rules* in this file (`AGENTS.md`), preserve *tests* in `tests/`, and drop everything else.
- **Do not proactively create `*.md` docs** unless the user requests them. The only hand-maintained project-level doc that must exist is this file plus `README.md` (for humans cloning the repo). Everything else is source or tests.

## 7. Quick-reference file map
| Concern | Location |
|---|---|
| Root layout / metadata / `suppressHydrationWarning` | [app/[locale]/layout.tsx](app/[locale]/layout.tsx) |
| Morphing Slab nav (constant slab, scroll-tighten, press keys) | [app/[locale]/components/Nav.tsx](app/[locale]/components/Nav.tsx) |
| Theme runtime helpers (apply/persist/resolve) | [app/lib/theme.ts](app/lib/theme.ts) |
| `themeInitScript()` + HTML injector (build time) | [scripts/inject-theme.mjs](scripts/inject-theme.mjs) |
| CSS variables + component classes + dock shell | [app/globals.css](app/globals.css) + [app/styles/](app/styles/) |
| i18n locale routing (`localePrefix: "always"`) | [i18n/routing.ts](i18n/routing.ts) |
| Root-path language negotiation (302) | [functions/index.js](functions/index.js) |
| i18n locale catalogues | [messages/zh.json](messages/zh.json) · [messages/en.json](messages/en.json) |
| i18n link primitives / request config | [i18n/navigation.ts](i18n/navigation.ts) · [i18n/request.ts](i18n/request.ts) |
| Presence heartbeat (online count, KV) | [functions/api/presence.js](functions/api/presence.js) + [Presence.tsx](app/[locale]/components/Presence.tsx) |
| GitHub stars proxy + KV cache + card | [functions/api/github/stars.js](functions/api/github/stars.js) + [GithubStarsCard.tsx](app/[locale]/components/GithubStarsCard.tsx) |
| http-check debug endpoints | [functions/api/echo.js](functions/api/echo.js) · [functions/api/headers.js](functions/api/headers.js) |
| Edge-function unit tests (fake KV, pure logic) | [tests/functions.test.ts](tests/functions.test.ts) |
| RSS feed (exported to `out/feed.xml`) | [app/feed.xml/route.ts](app/feed.xml/route.ts) |
| EdgeOne deploy config (out dir, redirects, HTML edge cache) | [edgeone.json](edgeone.json) |
| Test suite (grep contracts + unit) | [tests/](tests/) |
| Cross-feature zh/en × light/dark E2E script (manual) | [scripts/e2e-cross-feature.cjs](scripts/e2e-cross-feature.cjs) |
