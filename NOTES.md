# NOTES — Demo Repo Audit & Reuse Strategy

## 1. Repository inventory (current state)

| Item | Present? | Detail |
|------|----------|--------|
| Framework | No | Greenfield — no package.json, no Next.js / Jekyll / Hugo / Astro config |
| Source code | No | No src/, app/, pages/, content/ directory |
| Dependencies | No | No package.json / go.mod / Gemfile |
| Build scripts | No | None |
| Existing routes/pages | No | None |
| Assets | No | No images, fonts, favicons |
| Deploy config | No | No .github/workflows/, vercel.json, netlify.toml |
| README.md | Yes | Placeholder boilerplate ("A demo repository…") |
| .gitignore | Yes | Well-formed: covers node_modules, build output, env, IDE, Python, coverage |
| LICENSE | Yes | MIT, copyright 2026 ymslucky |
| Git remote | Yes | origin → https://github.com/ymslucky/demo.git (1 commit: "Initial commit") |
| Toolchain on dev host | — | Node v26.5.1 / npm 11.17.0 available; no Ruby/Go/Hugo binary |

**Conclusion:** this is a blank-slate repo. There is nothing to reuse from the repo itself — the audit is really a framework + deploy-target selection.

## 2. What to KEEP

- **MIT LICENSE** — keep as-is (already correct for an open personal site).
- **.gitignore** — keep; it already covers the Node ecosystem (node_modules, dist, build, .env variants) that the chosen framework will produce. No edits needed.
- **README.md** — keep the file, but rewrite its body in the rebuild task to describe the actual personal site (title, sections, local-dev instructions, deploy command). The current placeholder copy is demo boilerplate.

## 3. What to REPLACE

- **README placeholder copy** → real site description + run/build instructions.
- **(nothing else to replace)** — because the repo has no demo images, sample routes, or framework boilerplate yet. The rebuild task (t_dd46048d) will add all real content from scratch.

## 4. Framework selection — Astro (static output)

**Decision: Astro**, configured for fully static output (no SSR adapter).

Rationale:
- **Zero-JS-by-default** → ships only HTML+CSS for a content site, which directly satisfies the Lighthouse ≥ 90 performance bar set by the QA task (t_9abbdf8a).
- **First-class Markdown/MDX content collections** → the drafted content from t_ba67050a lands as `content/*.md` files with zero plumbing; frontmatter maps cleanly to project entries and blog posts.
- **File-based routing under `src/pages/`** → Home / About / Projects / Contact map to `index.astro`, `about.astro`, `projects/index.astro`, `contact.astro` with active nav states trivially.
- **Builds to plain static files** (`dist/`) → deploys to GitHub Pages with no server runtime, no functions, no edge config.
- **Toolchain match** — Node 26 / npm 11 on the dev host is exactly what Astro needs; no extra runtime (Ruby/Go) to install.
- **Adequate for scope** — a personal site with 4 pages and a handful of projects does not need Next.js' React hydration or API routes; Astro keeps the payload minimal while still allowing island components if interactivity is added later.

Rejected alternatives:
- *Next.js* — overkill (SSR/RSC machinery) for a static personal page; heavier client bundle hurts the Lighthouse target.
- *Hugo / Jekyll* — excellent for static sites but would require installing Go / Ruby on the dev host; neither is present, and Astro stays inside the existing Node toolchain.
- *Plain HTML* — would work, but loses file-based routing, reusable layouts, and Markdown content collections that make the rebuild task faster and the result easier to maintain.

## 5. Deploy target — GitHub Pages

**Decision: GitHub Pages**, via a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and publishes on every push to `main`.

Rationale:
- The repo **already lives on `github.com/ymslucky`**, so Pages gives a stable URL (`https://ymslucky.github.io/demo/`) with **zero new accounts, zero billing, zero external tokens**.
- GitHub Pages provides **free HTTPS** out of the box (certificate auto-provisioned), directly satisfying the "enable HTTPS" requirement in t_4c587924.
- The GitHub-native Actions deploy is reproducible from a fresh clone — the exact "redeploy is reproducible" acceptance criterion.
- A custom domain can be added later by committing a `CNAME` file and setting DNS; documented in the deploy task.

Rejected alternatives:
- *Vercel / Netlify / Cloudflare Pages* — all excellent, but each requires a separate account, an OAuth/token link to GitHub, and more config than a 4-page static site warrants when free Pages is already one toggle away.

## 6. Exact build command

```bash
npm install      # install deps (astro + tailwind)
npm run build    # astro build → emits static site into ./dist
```

`npm run build` resolves to `astro build` in package.json. The GitHub Actions workflow (added in t_4c587924) runs the same two commands and uploads `./dist` with the official `actions/upload-pages-artifact` action (path: `./dist`).

**Astro Pages note:** because the site is served from a sub-path (`/demo/`), the Astro config must set `site: "https://ymslucky.github.io"` and `base: "/demo/"` so all asset URLs resolve correctly.

## 7. One-paragraph reuse plan

The `ymslucky/demo` repo is a greenfield GitHub repository containing only a README, .gitignore, and MIT license — there is no existing framework, demo code, or assets to migrate, so the rebuild is a clean build rather than a refactor. We will scaffold the repo with **Astro** (static output, zero-JS by default, Markdown content collections) on top of the existing Node 26 / npm 11 toolchain, keep the MIT LICENSE and the already-Node-ready .gitignore verbatim, and replace the placeholder README with real site documentation. The personal copy drafted in t_ba67050a becomes `content/*.md` frontmatter-driven entries rendered through Astro layouts under `src/pages/` (index / about / projects / contact). The site builds with `npm run build` to a static `dist/` directory and deploys to **GitHub Pages** via a GitHub Actions workflow, which yields a stable `https://ymslucky.github.io/demo/` URL with automatic HTTPS at no cost and no extra accounts. This choice is designed to keep the rebuild task (t_dd46048d) framework-decision-free, the deploy task (t_4c587924) to a single workflow file, and the QA task's Lighthouse ≥ 90 target trivially achievable.
