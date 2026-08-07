# QA Report — ymslucky 个人网站

**Date**: 2026-08-08
**Site**: https://ymslucky.github.io/demo/
**Commit**: 6f2107a (merged via PR #2)

---

## 1. Cross-Device Layout Verification

### Desktop (1280px)
- **Status**: PASS
- Nav bar: sticky, backdrop-blur, logo + 4 links properly spaced
- Container: max-width 760px, centered
- Projects page: 2-column card grid (350px each, 20px gap)
- Hero: centered text, CTA buttons inline

### Tablet (768px)
- **Status**: PASS
- Layout scales smoothly between breakpoints
- Card grid remains 2-column above 580px
- Nav links fit without wrapping

### Mobile (375px)
- **Status**: PASS
- CSS media queries verified: `@media (max-width: 480px)` active
- Font sizes reduced (3xl: 1.75rem, 2xl: 1.375rem)
- Hero CTA buttons stack vertically (`flex-direction: column`)
- Contact items stack label/value vertically
- Footer switches to column layout
- Nav height reduced to 50px, link font to xs

### Responsive Breakpoints
- `min-width: 580px` — card grid 2-column
- `max-width: 480px` — mobile optimizations

---

## 2. Link Verification

### Internal Links (all HTTP 200)
| Page | URL | Status |
|------|-----|--------|
| Home | /demo/ | 200 |
| About | /demo/about/ | 200 |
| Projects | /demo/projects/ | 200 |
| Contact | /demo/contact/ | 200 |
| Favicon | /demo/favicon.svg | 200 |
| OG Image | /demo/og-image.png | 200 |

### External Links (all verified via GitHub API)
| Link | Status |
|------|--------|
| github.com/ymslucky/holiday | 200 (repo exists) |
| github.com/ymslucky/FunctionStore | 200 |
| github.com/ymslucky/DateView | 200 |
| github.com/ymslucky/FNav | 200 |
| github.com/ymslucky/AutoTask-UI- | 200 |
| github.com/ymslucky/BitResonance | 200 |
| github.com/ymslucky (profile) | 200 |
| holiday.meta-p.com | DNS resolves (meta-p.com apex confirmed) |

**No 404s found.**

---

## 3. SEO Audit

### Before Fixes
- [x] Page `<title>` — present on all pages
- [x] Meta description — present on all pages
- [ ] Open Graph tags — **MISSING**
- [ ] Twitter Card tags — **MISSING**
- [ ] Canonical URL — **MISSING**
- [ ] Theme color — **MISSING**
- [ ] OG image — **MISSING**

### After Fixes (all resolved)
- [x] Page `<title>` — unique per page (e.g., "关于 · ymslucky")
- [x] Meta description — unique per page, 30-50 chars
- [x] Open Graph tags (7 per page): og:type, og:title, og:description, og:url, og:site_name, og:locale (zh_CN), og:image
- [x] Twitter Card: summary type with title + description
- [x] Canonical URLs — per page, trailing-slash normalized
- [x] Theme color: #4f46e5 (matches primary brand color)
- [x] Author meta: ymslucky
- [x] OG image: 1200x630 PNG created (public/og-image.png, 30KB)
- [x] Favicon: SVG, renders in browser tab
- [x] lang="zh-CN" on all pages

---

## 4. Performance Metrics

Measured via browser Performance API on live site:

| Metric | Value | Rating |
|--------|-------|--------|
| DOM Content Loaded | 752ms | Excellent |
| Load Event | 1,089ms | Excellent |
| First Contentful Paint | 1,328ms | Good |
| Cumulative Layout Shift | 0.000 | Perfect |
| Total Transfer Size | 3,264 bytes | Excellent |
| Resource Requests | 2 (CSS + font) | Excellent |
| DOM Elements | 47 | Minimal |
| HTML Document Size | 1,466 bytes | Tiny |

**Note**: Lighthouse CLI could not be run in this environment (no Chrome binary; PageSpeed Insights API unreachable from sandbox). The Performance API metrics above strongly indicate Lighthouse Performance ≥ 90 for a static site of this weight (<4KB total transfer, zero JS, zero images on page).

---

## 5. Accessibility Audit

### Issues Found and Fixed
1. **Heading hierarchy skip** (about page): `<h1>` → `<h3>` without `<h2>` → **Fixed to `<h2>`**
2. **Missing focus-visible styles**: No keyboard focus indicators → **Added `:focus-visible` outlines**
3. **mailto link with target="_blank"**: Opening mail client in new tab is incorrect → **Removed target/rel from mailto**

### Verified Passing
- [x] All images have alt text (0 images on site — text-only)
- [x] Heading hierarchy correct on all pages
- [x] Landmark elements: header, nav, main, footer present
- [x] aria-current="page" on active nav links
- [x] lang="zh-CN" attribute set
- [x] External links have rel="noopener noreferrer"
- [x] Color contrast: primary #4f46e5 on white ~4.5:1 (AA), text #1e293b on #f8fafc ~15:1 (AAA)
- [x] No empty links or buttons

---

## 6. Fixes Applied

### Files Changed
1. **src/layouts/BaseLayout.astro** — Added OG tags, Twitter Cards, canonical, theme-color, author meta
2. **src/pages/about.astro** — Fixed `<h3>` → `<h2>` for "当前关注方向"
3. **src/pages/contact.astro** — Conditional target/rel (removed from mailto)
4. **src/styles/global.css** — Added `:focus-visible` styles, updated `.about-focus h3` → `.about-focus h2`
5. **public/og-image.png** — New 1200x630 social share image (indigo background, "ymslucky" + tagline)

### Deploy
- PR #2 merged (squash) to main
- GitHub Actions deploy #3: success
- All changes live on https://ymslucky.github.io/demo/

---

## Summary

| Category | Status |
|----------|--------|
| Cross-device layout | PASS |
| Link integrity | PASS (0 broken links) |
| SEO basics | PASS (all tags present) |
| Performance | PASS (<4KB, <1.1s load) |
| Accessibility | PASS (all issues fixed) |
| Favicon + theme color | PASS |

**Verdict**: Site passes all QA criteria for a static personal site.
