import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHsl,
  getColorStrings,
  convertCase,
  convertUnit,
  unitData,
  encodeBase64,
  decodeBase64,
  encodeBase64Url,
  decodeBase64Url,
  isHexColor,
  pushColorHistory,
  tokenizeJson,
  formatTimezone,
} from "../app/[locale]/tools/utils";

// ---- Color helpers ----
describe("hexToRgb", () => {
  it("parses #RRGGBB hex values", () => {
    expect(hexToRgb("#4f46e5")).toEqual([79, 70, 229]);
    expect(hexToRgb("#ff8800")).toEqual([255, 136, 0]);
  });

  it("handles black and white", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("handles pure red, green, blue", () => {
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("#00ff00")).toEqual([0, 255, 0]);
    expect(hexToRgb("#0000ff")).toEqual([0, 0, 255]);
  });
});

describe("rgbToHsl", () => {
  it("converts pure red", () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50]);
  });

  it("converts pure green", () => {
    expect(rgbToHsl(0, 255, 0)).toEqual([120, 100, 50]);
  });

  it("converts pure blue", () => {
    expect(rgbToHsl(0, 0, 255)).toEqual([240, 100, 50]);
  });

  it("converts achromatic colors with s=0", () => {
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 100]);
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("converts a mid-range color", () => {
    // #4f46e5 -> (79,70,229) -> HSL(243,75,59)
    expect(rgbToHsl(79, 70, 229)).toEqual([243, 75, 59]);
  });
});

describe("getColorStrings", () => {
  it("returns rgb and hsl display strings", () => {
    const c = getColorStrings("#4f46e5");
    expect(c.rgb).toBe("rgb(79, 70, 229)");
    expect(c.hsl).toBe("hsl(243, 75%, 59%)");
  });
});

// ---- Case conversion ----
describe("convertCase", () => {
  it("returns empty string for empty input", () => {
    expect(convertCase("upper", "")).toBe("");
  });

  it("upper mode", () => {
    expect(convertCase("upper", "hello world")).toBe("HELLO WORLD");
  });

  it("lower mode", () => {
    expect(convertCase("lower", "HELLO World")).toBe("hello world");
  });

  it("title mode", () => {
    expect(convertCase("title", "hello world foo")).toBe("Hello World Foo");
  });

  it("camel mode splits on spaces, underscores, hyphens", () => {
    expect(convertCase("camel", "hello world")).toBe("helloWorld");
    expect(convertCase("camel", "hello-world")).toBe("helloWorld");
    expect(convertCase("camel", "hello_world")).toBe("helloWorld");
    expect(convertCase("camel", "foo bar baz")).toBe("fooBarBaz");
    expect(convertCase("camel", "user-profile-data")).toBe("userProfileData");
    expect(convertCase("camel", "some_value_here")).toBe("someValueHere");
  });

  it("snake mode", () => {
    expect(convertCase("snake", "Hello World")).toBe("hello_world");
    expect(convertCase("snake", "hello-world")).toBe("hello_world");
    expect(convertCase("snake", "  hello  ")).toBe("hello");
  });

  it("passes through unknown modes", () => {
    expect(convertCase("unknown", "Hello")).toBe("Hello");
  });
});

// ---- Unit conversion ----
describe("convertUnit", () => {
  it("converts meters to kilometers", () => {
    expect(convertUnit("length", 0, 1, "1000")).toBe("1");
  });

  it("converts kilometers to meters", () => {
    expect(convertUnit("length", 1, 0, "1")).toBe("1000");
  });

  it("converts miles to meters", () => {
    expect(convertUnit("length", 6, 0, "1")).toBe("1609.344");
  });

  it("converts feet to inches", () => {
    expect(convertUnit("length", 5, 4, "1")).toBe("12");
  });

  it("converts inches to centimeters", () => {
    const result = convertUnit("length", 4, 2, "1");
    // 1 inch = 0.0254 m = 2.54 cm
    expect(parseFloat(result)).toBeCloseTo(2.54, 2);
  });

  it("converts celsius to fahrenheit", () => {
    expect(convertUnit("temperature", 0, 1, "0")).toBe("32");
    expect(parseFloat(convertUnit("temperature", 0, 1, "100"))).toBeCloseTo(212, 0);
  });

  it("converts fahrenheit to celsius", () => {
    expect(parseFloat(convertUnit("temperature", 1, 0, "32"))).toBeCloseTo(0, 0);
  });

  it("converts celsius to kelvin", () => {
    expect(convertUnit("temperature", 0, 2, "0")).toBe("273.15");
  });

  it("handles the -40C = -40F crossover", () => {
    expect(convertUnit("temperature", 0, 1, "-40")).toBe("-40");
  });

  it("converts data sizes", () => {
    expect(convertUnit("data", 1, 0, "1")).toBe("1024");
    expect(convertUnit("data", 2, 1, "1")).toBe("1024");
    expect(parseFloat(convertUnit("data", 2, 0, "1"))).toBe(1048576);
  });

  it("returns empty string for non-numeric input", () => {
    expect(convertUnit("length", 0, 1, "abc")).toBe("");
    expect(convertUnit("length", 0, 1, "")).toBe("");
  });
});

describe("unitData", () => {
  it("has length, temperature, and data categories", () => {
    expect(Object.keys(unitData).sort()).toEqual([
      "data",
      "length",
      "temperature",
    ]);
  });

  it("each category has at least 3 units", () => {
    for (const [, units] of Object.entries(unitData)) {
      expect(units.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---- Base64 ----
describe("encodeBase64 / decodeBase64", () => {
  it("round-trips ASCII text", () => {
    const input = "Hello, World!";
    const encoded = encodeBase64(input);
    expect(decodeBase64(encoded)).toBe(input);
  });

  it("encodes ASCII to known values", () => {
    expect(encodeBase64("Hello")).toBe("SGVsbG8=");
  });

  it("round-trips Unicode text (CJK, emoji)", () => {
    const inputs = ["你好，世界", "🎉🚀", "héllo wörld"];
    for (const input of inputs) {
      const encoded = encodeBase64(input);
      expect(decodeBase64(encoded)).toBe(input);
    }
  });

  it("handles empty string", () => {
    expect(encodeBase64("")).toBe("");
    expect(decodeBase64("")).toBe("");
  });
});

// ---- Timezone formatting ----
describe("formatTimezone", () => {
  it("formats a whole-hour offset (UTC+8)", () => {
    const d = { getTimezoneOffset: () => -480 } as unknown as Date;
    expect(formatTimezone(d)).toBe("UTC+08:00");
  });

  it("formats a 30-minute offset (UTC+5:30, India)", () => {
    const d = { getTimezoneOffset: () => -330 } as unknown as Date;
    expect(formatTimezone(d)).toBe("UTC+05:30");
  });

  it("formats a 45-minute offset (UTC+5:45, Nepal)", () => {
    const d = { getTimezoneOffset: () => -345 } as unknown as Date;
    expect(formatTimezone(d)).toBe("UTC+05:45");
  });

  it("formats a negative whole-hour offset (UTC-5)", () => {
    const d = { getTimezoneOffset: () => 300 } as unknown as Date;
    expect(formatTimezone(d)).toBe("UTC-05:00");
  });

  it("formats UTC (offset 0)", () => {
    const d = { getTimezoneOffset: () => 0 } as unknown as Date;
    expect(formatTimezone(d)).toBe("UTC+00:00");
  });
});

describe("convertCase: extended naming modes", () => {
  it("kebab mode lowercases and joins words with hyphens", () => {
    expect(convertCase("kebab", "Hello World")).toBe("hello-world");
    expect(convertCase("kebab", "foo_bar baz")).toBe("foo-bar-baz");
  });

  it("pascal mode title-cases concatenated words", () => {
    expect(convertCase("pascal", "hello world")).toBe("HelloWorld");
    expect(convertCase("pascal", "hello-world_foo")).toBe("HelloWorldFoo");
  });

  it("constant mode uppercases and joins words with underscores", () => {
    expect(convertCase("constant", "hello world")).toBe("HELLO_WORLD");
    expect(convertCase("constant", "hello-world")).toBe("HELLO_WORLD");
  });
});

describe("base64url", () => {
  it("encodes with the URL-safe alphabet and no padding", () => {
    const enc = encodeBase64Url("a+b/c=? hello 你好");
    expect(enc).not.toMatch(/[+/=]/);
  });

  it("round-trips arbitrary unicode (padded or unpadded input)", () => {
    const raw = "a+b/c=?\u4f60\u597d\u2192\u00e9";
    expect(decodeBase64Url(encodeBase64Url(raw))).toBe(raw);
    expect(decodeBase64Url(encodeBase64(raw))).toBe(raw); // padded standard input
  });
});

describe("color history helpers", () => {
  it("isHexColor accepts only canonical 6-digit hex", () => {
    expect(isHexColor("#ff0000")).toBe(true);
    expect(isHexColor("#FFF000")).toBe(true);
    expect(isHexColor("ff0000")).toBe(false);
    expect(isHexColor("#ff00")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it("pushColorHistory dedupes, front-inserts, lowercases and caps", () => {
    expect(pushColorHistory([], "#FF0000")).toEqual(["#ff0000"]);
    expect(pushColorHistory(["#ff0000"], "#FF0000")).toEqual(["#ff0000"]);
    const full = Array.from({ length: 10 }, (_, i) => "#aa000" + i);
    const next = pushColorHistory(full, "#bb0000");
    expect(next).toHaveLength(8);
    expect(next[0]).toBe("#bb0000");
  });
});

describe("tokenizeJson", () => {
  it("classifies keys, strings, numbers, booleans and null", () => {
    const tokens = tokenizeJson('{"a": 1, "b": [true, null], "c": "x"}');
    const byType = (type: string) =>
      tokens.filter((t) => t.type === type).map((t) => t.value);
    expect(byType("key")).toEqual(['"a"', '"b"', '"c"']);
    expect(byType("number")).toEqual(["1"]);
    expect(byType("boolean")).toEqual(["true"]);
    expect(byType("null")).toEqual(["null"]);
    expect(byType("string")).toEqual(['"x"']);
  });

  it("keeps escaped quotes inside strings without splitting", () => {
    const tokens = tokenizeJson('{"a":"say \\"hi\\""}');
    const meaningful = tokens.filter(
      (t) => t.type === "string" || t.type === "key"
    );
    expect(meaningful).toHaveLength(2);
    expect(tokens.some((t) => t.value.includes("say"))).toBe(true);
  });
});
