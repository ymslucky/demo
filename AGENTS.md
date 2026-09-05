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
- **Runtime**: Next.js **16.3.0** (App Router) · React **19.2.8** · TypeScript · next-intl · **no Tailwind** (plain hand-written CSS + CSS variables).
- **UI flavour**: **Neo-Brutalism**. Hard 3px borders, solid offset `box-shadow` (2-4px displacement, NO blur drop-shadows anywhere on structural cards/buttons/dock), #ea580c orange accent, Inter for body, JetBrains Mono fallback for `<code>`-style labels.
- **Nav UX**: **Morphing Slab** nav ([Nav.tsx](app/[locale]/components/Nav.tsx)). Invariants: the header is a *constant* full-width plate in every scroll position — it never morphs into a floating capsule; scrolling past 24px only tightens it and fills a progress rule (`header[data-scrolled]`, via [useDockMode.ts](app/[locale]/components/nav/useDockMode.ts)). Press physics ([useDockPress.ts](app/[locale]/components/nav/useDockPress.ts)): every pointer frame mutates styles inside a single `rAF` loop (zero React renders per frame) and feeds an under-damped spring shared with keyboard focus; `prefers-reduced-motion` and non-fine pointers disable motion entirely. Exact tuning constants live in the source — treat them as the documented "feel", not as free parameters.
- **Locale routing**: [middleware.ts](middleware.ts) wraps `next-intl/middleware`, default locale `zh` (unprefixed URLs `/`, `/about` …), alternate `en` under `/en/…`. `setRequestLocale(locale)` is called in [layout.tsx](app/[locale]/layout.tsx) so every page stays static-renderable.

## 1. HARD CONSTRAINTS — do not violate
1. **Middleware filename must stay `middleware.ts`** (not `proxy.ts`); the EdgeOne Pages deploy path mounts it by this exact name. The `middleware` deprecation warning in `next build` output is expected — *do not* run the suggested `middleware-to-proxy` codemod. Re-evaluate this rule only when the EdgeOne adapter (`@edgeone/opennextjs-pages`) officially supports `proxy.ts`; if that day comes, move the exact HTML-splice transform per §3 and re-run all gates.
2. **`app/**/*.ts(x)` keeps Chinese out of code** — string literals, JSX text nodes and identifiers must be CJK-free. Chinese **is allowed in comments** (`//`, `/* */`, JSDoc) for readability. Enforcement scope: `tests/i18n.test.ts` scans `app/` only and exempts `app/[locale]/blog/**` (standalone article content, not i18n UI copy). Outside `app/` there is no restriction (`messages/*.json`, `globals.css`, E2E scripts). Mechanism: comments are stripped via `ts.transpileModule({ removeComments: true })` (JSX preserved) before scanning, so only real code content is checked.
3. **User-facing strings & ARIA labels always go through next-intl** (`useTranslations`, `getTranslations`). Literal `aria-label="…"` with human words in TSX → failing test. Exceptions: machine-only attributes (`aria-current="page"`, `data-*`, CSS class names).
4. **Theme init is HTTP-layer injected, never a React `<script>` node**: [middleware.ts](middleware.ts) splices `<script>${themeInitScript()}</script>` right after the `<head>` marker; [layout.tsx](app/[locale]/layout.tsx) keeps `suppressHydrationWarning` on `<html>` (the script sets `data-theme` before hydration) and must contain **no** `<script>` JSX at all. Enforced by `tests/theme-i18n.test.ts`; rationale in §3.
5. **`@swc/helpers` pinned to `0.5.17`** via `package.json` → `"overrides"`. Bump only when you've verified both `next build --webpack` and `next dev --turbopack` still compile the App Router.

## 2. CSS Rules (Neo-Brutalism invariants)
- Keep every surface under a single family of variables in [globals.css](app/globals.css): `--color-border`, `--color-surface`, `--shadow-sm/lg/primary`, `--radius-sm/md/lg`.
- Blurred `box-shadow` is **disallowed** on UI elements. Depth is always a solid, displaced border-colored pixel block — `2px 2px 0 0 var(--color-border)` and its relatives. If you want lift, grow the *displacement*.
- Containers are fluid with clamp()-scaled gutters — `.container` / `.footer-container` use `padding-inline: clamp(var(--space-md), 4vw, var(--space-2xl))`. `.container` is additionally center-capped at `max-width: 100rem; margin-inline: auto` so ultra-wide (2K/4K) displays keep generous side margins; do not shrink that cap. Breakpoints are `880px` (brand collapses → single-letter mark) and `640px` (dock becomes scrollable rail). Respect them when adding new navigation chrome.
- Do **not** re-introduce Tailwind. The project intentionally ships 0 CSS-in-JS / utility-class runtime.

## 3. React 19 Script Injection — STANDARD WORKFLOW
React 19 emits a console warning **every time** a *client* render produces a `<script>` VDOM node ("Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client"). It fires on *every* client-side navigation (e.g. zh ⇄ en language toggle) because the root layout re-renders in the browser — independent of whether Next/SSR ever hoisted the tag server-side. **`next/script` + `strategy="beforeInteractive"` does NOT prevent the warning**; the JSX still creates the VDOM node.

### Approved pattern (used for the `themeInitScript()` anti-FOUC script):
1. **Inject at the HTTP layer, not in JSX.** [middleware.ts](middleware.ts) wraps the next-intl response, filters for `Content-Type: text/html`, reads the body, splices `<script>${themeInitScript()}</script>` right after the `<head>` marker (falls back to the start of `<body>`), rebuilds content-length and returns a fresh `NextResponse`. React **never** sees the script element.
2. **Known limitation — streaming.** `await response.text()` buffers the entire HTML body, so HTML responses are delivered non-chunked. This is acceptable today because every HTML route is prerendered and small. If a route ever streams intentionally (Suspense boundaries with slow segments), this pipeline must be redesigned first — do not silently add streaming routes under this middleware.
3. **Never render the script from a component.** There is no placeholder and no dead-code fallback: the layout renders zero `<script>` JSX, and `tests/theme-i18n.test.ts` fails if one reappears. The `suppressHydrationWarning` on `<html>` is *not* related to the script element itself — it suppresses the `data-theme` attribute mismatch caused by setting the attribute before hydration.
4. Ignore the warning's suggestion to use `<template>` — template content is inert and inline JS inside one does NOT auto-run on parse; it is a generic hint, not a fix for this case.
5. If `middleware.ts` is ever migrated to `proxy.ts`, move the *same* HTML-string-splice transform to the proxy's response hook — the invariant is "before React parses the HTML, not in the React tree".

## 4. Quality Gates (must all be green before any push)
```bash
npm test     # vitest run — grep contracts + unit tests
npm run lint # eslint . via eslint.config.mjs — TS rules enabled
npm run build  # next build --webpack
```
- **Render-mode guard**: the build's route table must not gain new Dynamic entries. The known dynamic set is exactly `/_not-found`, `/[locale]/tools/http-check` (reads `headers()`) and `/api/echo` (`force-dynamic`); everything else must remain Static/SSG. A new Dynamic route is a design decision, not an accident.
- `e2e-cross-feature.cjs` is a cross-feature matrix (i18n × theme) run **manually** — it is not part of `npm test`. When you rename container CSS classes (e.g. `.nav-links` → `.dock-nav`), update its `document.querySelector(...)` lines in the same commit.
- Any new tool-logic function added to `app/[locale]/tools/**/*.ts` must ship a sibling `*.test.ts` — `tests/tools.test.ts` is for shared helpers, not per-tool cases.

## 5. What to delete / not to create
- **Never commit per-session AI scratch pads**: `BRANDING.md`, `CLAUDE.md`, `DIAGNOSTIC_REPORT.md`, `QA_REPORT.md` and similar one-off audit docs must not live in the repo root. They were snapshots of specific sessions. Preserve *rules* in this file (`AGENTS.md`), preserve *tests* in `tests/`, and drop everything else.
- **Do not proactively create `*.md` docs** unless the user requests them. The only hand-maintained project-level doc that must exist is this file plus `README.md` (for humans cloning the repo). Everything else is source or tests.

## 6. Quick-reference file map
| Concern | Location |
|---|---|
| Root layout / metadata / `suppressHydrationWarning` | [app/\[locale\]/layout.tsx](app/[locale]/layout.tsx) |
| Morphing Slab nav (constant slab, scroll-tighten, press keys) | [app/\[locale\]/components/Nav.tsx](app/[locale]/components/Nav.tsx) |
| Theme logic + `themeInitScript()` source | [app/lib/theme.ts](app/lib/theme.ts) |
| HTML script injection (HTTP layer) | [middleware.ts](middleware.ts) |
| All CSS variables + component classes + dock shell | [app/globals.css](app/globals.css) |
| i18n locale routing | [middleware.ts](middleware.ts) + [i18n/routing.ts](i18n/routing.ts) |
| i18n locale catalogues | [messages/zh.json](messages/zh.json) · [messages/en.json](messages/en.json) |
| i18n link primitives / request config | [i18n/navigation.ts](i18n/navigation.ts) · [i18n/request.ts](i18n/request.ts) |
| Test suite (grep contracts + unit) | [tests/](tests/) |
| Cross-feature zh/en × light/dark E2E script (manual) | [e2e-cross-feature.cjs](e2e-cross-feature.cjs) |
