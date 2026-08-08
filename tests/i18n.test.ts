import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
