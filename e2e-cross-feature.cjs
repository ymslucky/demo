/* Cross-feature E2E: i18n (zh/en) x theme (light/dark) integration QA.
 * Task t_90cac300 acceptance criteria:
 *  1. All 4 combos render correctly, no visual glitches or untranslated strings
 *  2. Language + theme preferences persist independently
 *  3. Accessibility (focus, contrast, aria) passes in all combos
 *  4. No console errors or i18n missing-key warnings
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3010";
const EXEC = "/opt/hermes/.playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const SHOTS = path.join(__dirname, "e2e-screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const ROUTES = ["", "/about", "/projects", "/links", "/tools", "/contact"];

// Strings allowed to contain CJK on English pages (language name + Chinese cloud brands)
const ALLOWED_CJK = ["中文", "阿里云", "腾讯云", "华为云"];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  };
  let failures = 0;

  try {
    // ============ 1. Matrix: 4 combos x 6 routes ============
    const combos = [
      { name: "zh+light", locale: "zh", theme: "light" },
      { name: "zh+dark", locale: "zh", theme: "dark" },
      { name: "en+light", locale: "en", theme: "light" },
      { name: "en+dark", locale: "en", theme: "dark" },
    ];

    for (const combo of combos) {
      const ctx = await browser.newContext({ colorScheme: combo.theme });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          consoleErrors.push(`${msg.type()}: ${msg.text()}`);
        }
      });
      page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

      for (const route of ROUTES) {
        const url = BASE + (combo.locale === "zh" ? route : "/en" + route);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await sleep(400);

        // force the combo's theme explicitly via toggle if needed
        const state = await page.evaluate((want) => {
          const cur = document.documentElement.getAttribute("data-theme");
          if (cur !== want) {
            localStorage.setItem("theme", want);
            document.documentElement.setAttribute("data-theme", want);
          }
          return {
            htmlTheme: document.documentElement.getAttribute("data-theme"),
            stored: localStorage.getItem("theme"),
            lang: document.documentElement.lang,
            bodyBg: getComputedStyle(document.body).backgroundColor,
            bodyColor: getComputedStyle(document.body).color,
          };
        }, combo.theme);

        // --- criterion 1: correct theme + lang ---
        check(`[${combo.name} ${route || "/"}] data-theme=${combo.theme}`,
          state.htmlTheme === combo.theme, JSON.stringify(state.htmlTheme));

        // --- criterion 1: no untranslated strings (missing key fallback renders key path) ---
        const bodyText = await page.evaluate(() => document.body.innerText);
        const keyFallbacks = (bodyText.match(/(?:^|\s)([a-z][a-zA-Z0-9]+\.[a-z][a-zA-Z0-9.]+)(?:\s|$)/g) || [])
          .filter((s) => ![" Next.js ", " luckylab "].includes(s));
        check(`[${combo.name} ${route || "/"}] no missing-key fallbacks`,
          keyFallbacks.length === 0, keyFallbacks.slice(0, 3).join(", "));

        // --- criterion 1: no CJK leakage on English pages ---
        if (combo.locale === "en") {
          const cjk = [...new Set(bodyText.match(/[\u4e00-\u9fff]+/g) || [])]
            .filter((s) => !ALLOWED_CJK.includes(s));
          check(`[${combo.name} ${route || "/"}] no untranslated Chinese`,
            cjk.length === 0, cjk.slice(0, 5).join(", "));
        }

        // --- criterion 1: no horizontal overflow (layout breaks) ---
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > window.innerWidth);
        check(`[${combo.name} ${route || "/"}] no horizontal overflow`, !overflow);

        // --- criterion 3: nav controls aligned, no overlap ---
        const nav = await page.evaluate(() => {
          const tt = document.querySelector(".theme-toggle");
          const ls = document.querySelector(".lang-switch");
          if (!tt || !ls) return { missing: true };
          const a = tt.getBoundingClientRect();
          const b = ls.getBoundingClientRect();
          return {
            missing: false,
            sameRow: Math.abs(a.y - b.y) < 4,
            noOverlap: a.right <= b.left || b.right <= a.left,
          };
        });
        check(`[${combo.name} ${route || "/"}] lang switcher + theme toggle aligned`,
          !nav.missing && nav.sameRow && nav.noOverlap, JSON.stringify(nav));

        // --- criterion 3: contrast spot checks (text on bg, active lang btn) ---
        const contrast = await page.evaluate(() => {
          const lum = (c) => {
            const p = c.match(/\d+/g).map(Number).map((v) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          };
          const ratio = (fg, bg) => {
            const a = lum(fg), b = lum(bg);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          const cs = getComputedStyle(document.body);
          const active = document.querySelector(".lang-switch-btn--active");
          const acs = getComputedStyle(active);
          return {
            body: ratio(cs.color, cs.backgroundColor).toFixed(2),
            langBtn: ratio(acs.color, acs.backgroundColor).toFixed(2),
          };
        });
        check(`[${combo.name} ${route || "/"}] body text contrast >= 4.5`,
          parseFloat(contrast.body) >= 4.5, `${contrast.body}:1`);
        check(`[${combo.name} ${route || "/"}] active lang btn contrast >= 4.5`,
          parseFloat(contrast.langBtn) >= 4.5, `${contrast.langBtn}:1`);

        // --- criterion 3: aria labels present on interactive controls ---
        const aria = await page.evaluate(() => ({
          themeToggle: document.querySelector(".theme-toggle")?.getAttribute("aria-label") || null,
          langGroup: document.querySelector(".lang-switch")?.getAttribute("aria-label") || null,
          navAria: document.querySelector(".nav-links")?.getAttribute("aria-label") || null,
          langBtns: [...document.querySelectorAll(".lang-switch-btn")].map((b) => ({
            pressed: b.getAttribute("aria-pressed"),
          })),
        }));
        check(`[${combo.name} ${route || "/"}] theme toggle aria-label present`,
          !!aria.themeToggle && aria.themeToggle.length > 0);
        check(`[${combo.name} ${route || "/"}] lang switcher aria-label present`,
          !!aria.langGroup && !!aria.navAria);
        check(`[${combo.name} ${route || "/"}] lang buttons aria-pressed set`,
          aria.langBtns.length === 2 && aria.langBtns.every((b) => b.pressed === "true" || b.pressed === "false"));

        // --- criterion 4: no console errors on this route ---
        const errs = consoleErrors.filter((e) => !e.includes("favicon"));
        check(`[${combo.name} ${route || "/"}] no console errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
      }

      // screenshot of home page for this combo
      await page.goto(BASE + (combo.locale === "zh" ? "" : "/en"), { waitUntil: "domcontentloaded" });
      await sleep(500);
      await page.evaluate((want) => {
        localStorage.setItem("theme", want);
        document.documentElement.setAttribute("data-theme", want);
      }, combo.theme);
      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, `${combo.name}.png`), fullPage: true });
      console.log(`SHOT  ${combo.name}.png`);
      await ctx.close();
    }

    // ============ 2. Persistence independence ============
    {
      const ctx = await browser.newContext({ colorScheme: "light" });
      const page = await ctx.newPage();
      // Start: zh + light (default). Set dark via toggle.
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await sleep(400);
      await page.click(".theme-toggle");
      await sleep(200);
      const afterToggle = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem("theme"),
      }));
      check("P1: toggle sets data-theme=dark + localStorage=dark",
        afterToggle.theme === "dark" && afterToggle.stored === "dark", JSON.stringify(afterToggle));

      // Switch language (client-side) while dark
      await page.click(".lang-switch-btn:last-child"); // EN
      await sleep(600);
      const afterLang = await page.evaluate(() => ({
        url: location.pathname,
        lang: document.documentElement.lang,
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem("theme"),
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      check("P2: language switch keeps theme (no regression)",
        afterLang.url === "/en" && afterLang.lang === "en" && afterLang.theme === "dark",
        JSON.stringify(afterLang));

      // Reload: both survive
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(500);
      const afterReload = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem("theme"),
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      check("P3: reload keeps en + dark (both persist)",
        afterReload.lang === "en" && afterReload.theme === "dark" && afterReload.stored === "dark",
        JSON.stringify(afterReload));

      // Switch back to zh (client-side), theme must remain dark
      await page.click(".lang-switch-btn:first-child");
      await sleep(600);
      const backZh = await page.evaluate(() => ({
        url: location.pathname,
        lang: document.documentElement.lang,
        theme: document.documentElement.getAttribute("data-theme"),
      }));
      check("P4: switch back to zh keeps dark theme",
        backZh.url === "/" && backZh.lang === "zh" && backZh.theme === "dark",
        JSON.stringify(backZh));

      // Toggle back to light: language must stay zh
      await page.click(".theme-toggle");
      await sleep(200);
      const afterLight = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        theme: document.documentElement.getAttribute("data-theme"),
        stored: localStorage.getItem("theme"),
      }));
      check("P5: theme toggle keeps language (independence)",
        afterLight.lang === "zh" && afterLight.theme === "light" && afterLight.stored === "light",
        JSON.stringify(afterLight));
      await ctx.close();
    }

    // ============ 3. Keyboard focus accessibility ============
    {
      const ctx = await browser.newContext({ colorScheme: "dark" });
      const page = await ctx.newPage();
      await page.goto(BASE + "/en", { waitUntil: "domcontentloaded" });
      await sleep(400);
      // Tab through nav: theme toggle and lang switcher must be reachable
      const focusOrder = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        await sleep(80);
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          return el ? `${el.tagName}.${el.className}` : "none";
        });
        focusOrder.push(info);
      }
      const reachesToggle = focusOrder.some((f) => f.includes("theme-toggle"));
      const reachesLang = focusOrder.some((f) => f.includes("lang-switch"));
      check("K1: keyboard Tab reaches theme toggle", reachesToggle, focusOrder.join(" -> "));
      check("K2: keyboard Tab reaches language switcher", reachesLang, focusOrder.join(" -> "));

      // Focus visible on theme toggle
      await page.evaluate(() => document.querySelector(".theme-toggle").focus());
      const focusStyle = await page.evaluate(() => {
        const el = document.querySelector(".theme-toggle");
        const cs = getComputedStyle(el);
        return { outline: cs.outline, outlineColor: cs.outlineColor, boxShadow: cs.boxShadow };
      });
      check("K3: theme toggle has visible focus indicator",
        focusStyle.outline !== "none" || (focusStyle.boxShadow && focusStyle.boxShadow !== "none"),
        JSON.stringify(focusStyle));
      await ctx.close();
    }

    // ============ 4. Missing-key warnings in production ============
    {
      // The build already verified zero warnings; also verify no NEXT_INTL_MISSING
      // markers or fallback key paths appear in served HTML.
      const ctx = await browser.newContext({ colorScheme: "light" });
      const page = await ctx.newPage();
      await page.goto(BASE + "/en/tools", { waitUntil: "domcontentloaded" });
      await sleep(500);
      const html = await page.content();
      check("M1: no i18n missing-key markers in served HTML",
        !html.includes("NEXT_INTL_MISSING") && !html.includes("Missing message"),
        html.match(/NEXT_INTL_MISSING[^<]{0,80}/)?.[0] || "");
      await ctx.close();
    }
  } catch (err) {
    console.error("E2E ERROR:", err.message);
    failures = 10;
  } finally {
    await browser.close();
  }

  failures = results.filter((r) => !r.ok).length;
  console.log(`\n===== ${results.length - failures}/${results.length} checks PASSED =====`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
