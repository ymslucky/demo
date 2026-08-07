import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHsl,
  convertCase,
  computeUnitResult,
  unitData,
} from "../app/tools/utils";

describe("hexToRgb", () => {
  it("converts a 6-digit hex to RGB tuple", () => {
    expect(hexToRgb("#4f46e5")).toEqual([79, 70, 229]);
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
  it("converts primary indigo (#4f46e5)", () => {
    const [r, g, b] = hexToRgb("#4f46e5");
    const [h, s, l] = rgbToHsl(r, g, b);
    expect(h).toBeGreaterThanOrEqual(240);
    expect(h).toBeLessThanOrEqual(245);
    expect(s).toBeGreaterThan(70);
    expect(l).toBeGreaterThan(50);
  });

  it("returns [0,0,0] for pure black", () => {
    expect(rgbToHsl(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("returns [0,0,100] for pure white", () => {
    expect(rgbToHsl(255, 255, 255)).toEqual([0, 0, 100]);
  });

  it("red has hue 0", () => {
    const [h] = rgbToHsl(255, 0, 0);
    expect(h).toBe(0);
  });

  it("green has hue 120", () => {
    const [h] = rgbToHsl(0, 255, 0);
    expect(h).toBe(120);
  });

  it("blue has hue 240", () => {
    const [h] = rgbToHsl(0, 0, 255);
    expect(h).toBe(240);
  });
});

describe("convertCase", () => {
  it("returns empty string for empty input", () => {
    expect(convertCase("upper", "")).toBe("");
  });

  it("upper case", () => {
    expect(convertCase("upper", "hello world")).toBe("HELLO WORLD");
  });

  it("lower case", () => {
    expect(convertCase("lower", "HELLO WORLD")).toBe("hello world");
  });

  it("title case", () => {
    expect(convertCase("title", "hello world foo")).toBe(
      "Hello World Foo"
    );
  });

  it("camelCase", () => {
    expect(convertCase("camel", "hello world foo")).toBe("helloWorldFoo");
    expect(convertCase("camel", "user-profile-data")).toBe(
      "userProfileData"
    );
    expect(convertCase("camel", "some_value_here")).toBe("someValueHere");
  });

  it("snake_case", () => {
    expect(convertCase("snake", "Hello World")).toBe("hello_world");
    expect(convertCase("snake", "hello-world foo")).toBe("hello_world_foo");
  });

  it("default returns input unchanged", () => {
    expect(convertCase("unknown", "test")).toBe("test");
  });
});

describe("computeUnitResult", () => {
  it("converts meters to kilometers", () => {
    const result = computeUnitResult("length", 0, 1, "1000");
    expect(result).toBe("1");
  });

  it("converts kilometers to meters", () => {
    const result = computeUnitResult("length", 1, 0, "1");
    expect(result).toBe("1000");
  });

  it("converts inches to centimeters", () => {
    const result = computeUnitResult("length", 4, 2, "1");
    // 1 inch = 0.0254 m = 2.54 cm
    expect(parseFloat(result)).toBeCloseTo(2.54, 2);
  });

  it("converts celsius to fahrenheit", () => {
    const result = computeUnitResult("temperature", 0, 1, "100");
    // 100°C = 212°F
    expect(parseFloat(result)).toBeCloseTo(212, 0);
  });

  it("converts fahrenheit to celsius", () => {
    const result = computeUnitResult("temperature", 1, 0, "32");
    // 32°F = 0°C
    expect(parseFloat(result)).toBeCloseTo(0, 0);
  });

  it("converts celsius to kelvin", () => {
    const result = computeUnitResult("temperature", 0, 2, "0");
    // 0°C = 273.15 K
    expect(parseFloat(result)).toBeCloseTo(273.15, 1);
  });

  it("converts bytes to kilobytes", () => {
    const result = computeUnitResult("data", 0, 1, "2048");
    expect(result).toBe("2");
  });

  it("converts megabytes to bytes", () => {
    const result = computeUnitResult("data", 2, 0, "1");
    expect(parseFloat(result)).toBe(1048576);
  });

  it("returns empty string for invalid number", () => {
    expect(computeUnitResult("length", 0, 1, "abc")).toBe("");
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
