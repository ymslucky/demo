import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { routing } from "../i18n/routing";

/** Flatten a nested message object into dotted leaf keys. */
function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flatten(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function loadCatalog(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("i18n routing", () => {
  it("defaults to Chinese and supports English", () => {
    expect(routing.defaultLocale).toBe("zh");
    expect(routing.locales).toEqual(["zh", "en"]);
  });

  it("uses as-needed locale prefixing so default locale stays at root", () => {
    expect(routing.localePrefix).toBe("as-needed");
  });
});

describe("message catalogs", () => {
  it("has a catalog for every configured locale", () => {
    for (const locale of routing.locales) {
      const catalog = loadCatalog(locale);
      expect(Object.keys(catalog).length).toBeGreaterThan(0);
    }
  });

  it("zh and en catalogs expose identical key structures", () => {
    const zhKeys = flatten(loadCatalog("zh")).sort();
    const enKeys = flatten(loadCatalog("en")).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("covers the namespaces used by layouts, pages and components", () => {
    const zh = loadCatalog("zh");
    for (const ns of [
      "metadata",
      "nav",
      "footer",
      "languageSwitcher",
      "home",
      "about",
      "projects",
      "links",
      "contact",
      "tools",
      "unit",
    ]) {
      expect(zh[ns], `missing namespace: ${ns}`).toBeDefined();
    }
  });

  it("has no empty or placeholder values in either catalog", () => {
    for (const locale of routing.locales) {
      const catalog = loadCatalog(locale);
      for (const key of flatten(catalog)) {
        let value: unknown = catalog;
        for (const part of key.split(".")) {
          if (
            value &&
            typeof value === "object" &&
            part in (value as Record<string, unknown>)
          ) {
            value = (value as Record<string, unknown>)[part];
          } else {
            value = undefined;
            break;
          }
        }
        if (Array.isArray(value)) {
          expect(value.length, `${locale}.${key} is an empty array`).toBeGreaterThan(0);
        } else if (typeof value === "string") {
          expect(value, `${locale}.${key} is empty`).not.toBe("");
          expect(value, `${locale}.${key} is a placeholder`).not.toMatch(/^KEY(_[A-Z0-9]+)*$/);
        }
      }
    }
  });
});

/** Recursively collect all .ts/.tsx files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Maps translator variable names (t, tu, ...) to their message namespace. */
function namespacesForFile(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const patterns = [
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?getTranslations\(\s*\{\s*[^}]*namespace:\s*"([^"]+)"\s*\}/g,
  ];
  for (const pattern of patterns) {
    for (const m of src.matchAll(pattern)) {
      result[m[1]] = m[2];
    }
  }
  return result;
}

/**
 * Parses a top-level `const <name> = <json-like literal>` (optionally typed,
 * e.g. `const categories: LinkCategory[] = [...]`) from source and returns
 * the literal as parsed JSON. Returns undefined when not found.
 */
function extractConst(src: string, name: string): unknown {
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::\\s*[^=]+)?=\\s*`,
  );
  const match = re.exec(src);
  if (!match) return undefined;
  let i = match.index + match[0].length;
  while (i < src.length && /\s/.test(src[i])) i++;
  const start = i;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) {
        // The literal is TypeScript (unquoted keys, trailing commas), so
        // normalize it to strict JSON before parsing.
        const raw = src.slice(start, i + 1);
        const json =
          raw
            // Remove Component values before parsing (e.g. Component: JsonFormatter)
            .replace(/,\s*Component\s*:\s*[A-Za-z0-9_]+/g, "")
            .replace(/Component\s*:\s*[A-Za-z0-9_]+\s*,/g, "")
            // Quote bare object keys: `key: "cloud"` -> `"key": "cloud"`
            .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
            // Drop trailing commas before } or ]
            .replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(json);
      }
    }
  }
  return undefined;
}

/** Generates the message keys the links page requests from its data. */
function linkKeysFor(data: unknown): string[] {
  const out: string[] = [];
  for (const cat of (data as Array<{ key: string; links: Array<{ key: string }> }>)) {
    out.push(`categories.${cat.key}.title`);
    for (const link of cat.links) {
      out.push(`categories.${cat.key}.links.${link.key}.name`);
      out.push(`categories.${cat.key}.links.${link.key}.desc`);
    }
  }
  return out;
}

/** Generates the message keys the projects page requests from its data. */
function projectKeysFor(data: unknown): string[] {
  const out: string[] = [];
  for (const project of (data as Array<{ key: string }>)) {
    out.push(`items.${project.key}.name`);
    out.push(`items.${project.key}.description`);
    out.push(`items.${project.key}.tags`);
  }
  return out;
}

/** Generates the message keys the tools page requests from its data. */
function toolKeysFor(data: unknown): string[] {
  const out: string[] = [];
  for (const tool of (data as Array<{ key: string }>)) {
    out.push(`items.${tool.key}.name`);
    out.push(`items.${tool.key}.description`);
  }
  return out;
}

/**
 * Extracts unit label keys directly from the unitData source. Unlike the
 * other data literals, unitData contains arithmetic expressions (e.g.
 * `factor: 5 / 9`), so it cannot be normalized to JSON; a brace-depth scan
 * picks out `category` keys and `label: "..."` values instead.
 */
function unitKeysFromSrc(src: string): string[] {
  const header = /(?:export\s+)?const\s+unitData\s*(?::\s*[^=]+)?=\s*\{/.exec(
    src,
  );
  if (!header) return [];
  const out: string[] = [];
  let depth = 1; // inside the unitData object
  let category = "";
  let inString = false;
  let escaped = false;
  for (let i = header.index + header[0].length; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) break; // end of unitData literal
      continue;
    }
    if (depth === 1) {
      const cat = src.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (cat) {
        category = cat[1];
        i += cat[0].length - 1;
        continue;
      }
    }
    if (depth >= 2) {
      const label = src.slice(i).match(/^label\s*:\s*"([^"]+)"/);
      if (label) {
        out.push(`${category}.${label[1]}`);
        i += label[0].length - 1;
        continue;
      }
    }
  }
  return out;
}

describe("key usage coverage", () => {
  const zhKeys = new Set(flatten(loadCatalog("zh")));
  const enKeys = new Set(flatten(loadCatalog("en")));
  const haveKey = (key: string) => zhKeys.has(key) && enKeys.has(key);

  it("has no hardcoded Chinese in user-facing source files", () => {
    // Acceptance: all user-facing text goes through t(). Chinese characters
    // are only allowed in CSS comments (globals.css) and test fixtures.
    const offenders: string[] = [];
    for (const file of collectSourceFiles(join(process.cwd(), "app"))) {
      if (file.endsWith("globals.css")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/[\u4e00-\u9fff]/.test(line)) {
          offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("resolves every statically referenced key in both catalogs", () => {
    const missing: string[] = [];
    for (const file of collectSourceFiles(join(process.cwd(), "app"))) {
      const src = readFileSync(file, "utf8");
      const namespaces = namespacesForFile(src);
      if (Object.keys(namespaces).length === 0) continue;
      for (const m of src.matchAll(/(\w+)\.raw?\(\s*"([^"]+)"\s*\)/g)) {
        const ns = namespaces[m[1]];
        if (!ns) continue; // not a translator call
        if (!haveKey(`${ns}.${m[2]}`)) {
          missing.push(`${file}: ${ns}.${m[2]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves every dynamically referenced key in both catalogs", () => {
    const appDir = join(process.cwd(), "app");
    const read = (rel: string) => readFileSync(join(appDir, rel), "utf8");
    const checks: Array<[string, string, string[]]> = [
      [
        "links/page.tsx",
        "links",
        linkKeysFor(extractConst(read("[locale]/links/page.tsx"), "categories")),
      ],
      [
        "projects/page.tsx",
        "projects",
        projectKeysFor(extractConst(read("[locale]/projects/page.tsx"), "projects")),
      ],
      [
        "tools/ToolsClient.tsx",
        "tools",
        toolKeysFor(extractConst(read("[locale]/tools/ToolsClient.tsx"), "tools")),
      ],
      [
        "tools/utils.ts",
        "unit",
        unitKeysFromSrc(read("[locale]/tools/utils.ts")),
      ],
    ];
    const missing: string[] = [];
    for (const [file, ns, keys] of checks) {
      for (const key of keys) {
        if (!haveKey(`${ns}.${key}`)) {
          missing.push(`${appDir}/${file}: ${ns}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

