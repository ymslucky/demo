import { describe, it, expect } from "vitest";
import {
  extractClientIp,
  parseUserAgent,
  isBot,
} from "./utils";

describe("extractClientIp", () => {
  it("优先使用 EdgeOne 专用头", () => {
    const r = extractClientIp({
      "eo-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "5.6.7.8",
    });
    expect(r).toEqual({ ip: "1.2.3.4", source: "eo-connecting-ip" });
  });

  it("从 x-forwarded-for 链式列表中取最左段", () => {
    const r = extractClientIp({
      "x-forwarded-for": "203.0.113.50, 10.0.0.1, 10.0.0.2",
    });
    expect(r).toEqual({ ip: "203.0.113.50", source: "x-forwarded-for" });
  });

  it("忽略 unknown 值并回退到下一个候选头", () => {
    const r = extractClientIp({ "x-real-ip": "unknown", "client-ip": "8.8.8.8" });
    expect(r).toEqual({ ip: "8.8.8.8", source: "client-ip" });
  });

  it("没有可用头时返回 null", () => {
    expect(extractClientIp({})).toBeNull();
    expect(extractClientIp({ "x-real-ip": "" })).toBeNull();
  });
});

describe("parseUserAgent — 浏览器", () => {
  it("Edge 不被误判为 Chrome，且版本号完整", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
    const info = parseUserAgent(ua);
    expect(info.browser).toBe("Edge");
    expect(info.version).toBe("126.0.0.0");
  });

  it("Firefox", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
    const info = parseUserAgent(ua);
    expect(info.browser).toBe("Firefox");
    expect(info.version).toBe("127.0");
  });

  it("纯 Safari（不含 Chrome）走兜底分支", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    const info = parseUserAgent(ua);
    expect(info.browser).toBe("Safari");
    expect(info.version).toBe("17.4");
  });

  it("空 UA 返回 Unknown 且不抛错", () => {
    const info = parseUserAgent("");
    expect(info.browser).toBe("Unknown");
    expect(info.os).toBe("Unknown");
  });
});

describe("parseUserAgent — 操作系统与设备", () => {
  it("Windows NT 10.x 显示为 Windows 10/11 桌面端", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0";
    const info = parseUserAgent(ua);
    expect(info.os).toBe("Windows 10/11");
    expect(info.device).toBe("desktop");
  });

  it("Windows 7 保留历史名称", () => {
    const ua = "Mozilla/5.0 (Windows NT 6.1; WOW64) Chrome/98.0.0.0";
    expect(parseUserAgent(ua).os).toBe("Windows 7");
  });

  it("iPhone 归为移动端并解析 iOS 版本", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
    const info = parseUserAgent(ua);
    expect(info.device).toBe("mobile");
    expect(info.os).toBe("iOS 17.5.1");
  });

  it("无 Mobile 后缀的 Android 归为平板", () => {
    const ua = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    const info = parseUserAgent(ua);
    expect(info.device).toBe("tablet");
    expect(info.os).toBe("Android 13");
  });

  it("带 Mobile 的 Android 归为手机", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36";
    const info = parseUserAgent(ua);
    expect(info.device).toBe("mobile");
  });

  it("macOS 下划线版本规范为点分", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36";
    expect(parseUserAgent(ua).os).toBe("macOS 10.15.7");
  });
});

describe("isBot", () => {
  it("识别常见爬虫关键词", () => {
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("HeadlessChrome/121")).toBe(true);
  });

  it("普通浏览器不是爬虫", () => {
    expect(isBot("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0")).toBe(false);
  });
});
