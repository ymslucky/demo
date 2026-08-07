"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ---- Unit converter data ----
interface UnitDef {
  label: string;
  factor: number;
  offset?: number;
}

const unitData: Record<string, UnitDef[]> = {
  length: [
    { label: "米 (m)", factor: 1 },
    { label: "千米 (km)", factor: 1000 },
    { label: "厘米 (cm)", factor: 0.01 },
    { label: "毫米 (mm)", factor: 0.001 },
    { label: "英寸 (in)", factor: 0.0254 },
    { label: "英尺 (ft)", factor: 0.3048 },
    { label: "英里 (mi)", factor: 1609.344 },
  ],
  temperature: [
    { label: "摄氏度 (°C)", factor: 1, offset: 0 },
    { label: "华氏度 (°F)", factor: 5 / 9, offset: -32 * (5 / 9) },
    { label: "开尔文 (K)", factor: 1, offset: -273.15 },
  ],
  data: [
    { label: "字节 (B)", factor: 1 },
    { label: "千字节 (KB)", factor: 1024 },
    { label: "兆字节 (MB)", factor: 1024 ** 2 },
    { label: "吉字节 (GB)", factor: 1024 ** 3 },
    { label: "太字节 (TB)", factor: 1024 ** 4 },
  ],
};

// ---- Color helpers ----
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// ---- Case converter ----
function convertCase(mode: string, input: string): string {
  if (!input) return "";
  switch (mode) {
    case "upper":
      return input.toUpperCase();
    case "lower":
      return input.toLowerCase();
    case "title":
      return input.replace(
        /\w\S*/g,
        (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      );
    case "camel": {
      const parts = input.toLowerCase().split(/[\s_-]+/).filter(Boolean);
      return parts
        .map((p, i) =>
          i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
        )
        .join("");
    }
    case "snake":
      return input.trim().toLowerCase().replace(/[\s-]+/g, "_");
    default:
      return input;
  }
}

const tools = [
  {
    id: "json-formatter",
    icon: "json",
    name: "JSON 格式化",
    description: "美化、压缩与校验 JSON 数据，自动高亮语法错误位置。",
  },
  {
    id: "base64",
    icon: "b64",
    name: "Base64 编解码",
    description: "在文本与 Base64 之间双向转换，支持 Unicode。",
  },
  {
    id: "timestamp",
    icon: "ts",
    name: "时间戳转换",
    description: "Unix 时间戳与日期字符串互转，毫秒 / 秒自动识别。",
  },
  {
    id: "unit-converter",
    icon: "unit",
    name: "单位换算",
    description: "长度、温度、数据容量常用单位快速换算。",
  },
  {
    id: "color-picker",
    icon: "color",
    name: "颜色选择器",
    description: "可视化拾取颜色，实时输出 HEX / RGB / HSL。",
  },
  {
    id: "case-converter",
    icon: "case",
    name: "文本大小写转换",
    description: "UPPER、lower、Title、camelCase 等多种模式一键转换。",
  },
];

export default function ToolsPage() {
  // JSON Formatter state
  const [jsonInput, setJsonInput] = useState("");
  const [jsonOutput, setJsonOutput] = useState("");
  const [jsonErr, setJsonErr] = useState(false);

  const jsonFormat = () => {
    if (!jsonInput.trim()) {
      setJsonOutput("");
      return;
    }
    try {
      const parsed = JSON.parse(jsonInput);
      setJsonOutput(JSON.stringify(parsed, null, 2));
      setJsonErr(false);
    } catch (e) {
      setJsonOutput("✗ " + (e as Error).message);
      setJsonErr(true);
    }
  };

  const jsonMinify = () => {
    if (!jsonInput.trim()) return;
    try {
      const parsed = JSON.parse(jsonInput);
      setJsonOutput(JSON.stringify(parsed));
      setJsonErr(false);
    } catch (e) {
      setJsonOutput("✗ " + (e as Error).message);
      setJsonErr(true);
    }
  };

  const jsonClear = () => {
    setJsonInput("");
    setJsonOutput("");
  };

  // Base64 state
  const [b64Input, setB64Input] = useState("");
  const [b64Output, setB64Output] = useState("");
  const [b64Err, setB64Err] = useState(false);

  const b64Encode = () => {
    try {
      setB64Output(btoa(unescape(encodeURIComponent(b64Input))));
      setB64Err(false);
    } catch {
      setB64Output("✗ 编码失败");
      setB64Err(true);
    }
  };

  const b64Decode = () => {
    const input = b64Input.trim();
    try {
      setB64Output(decodeURIComponent(escape(atob(input))));
      setB64Err(false);
    } catch {
      setB64Output("✗ 无效的 Base64 字符串");
      setB64Err(true);
    }
  };

  // Timestamp state
  const [tsNow, setTsNow] = useState("");
  const [tsInput, setTsInput] = useState("");
  const [tsToDate, setTsToDate] = useState("");
  const [tsToDateErr, setTsToDateErr] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [tsToTs, setTsToTs] = useState("");
  const [tsToTsErr, setTsToTsErr] = useState(false);

  const refreshTs = useCallback(() => {
    setTsNow(String(Math.floor(Date.now() / 1000)));
  }, []);

  useEffect(() => {
    refreshTs();
  }, [refreshTs]);

  const handleTsToDate = (raw: string) => {
    setTsInput(raw);
    if (!raw.trim()) {
      setTsToDate("");
      return;
    }
    let ts = Number(raw);
    if (raw.length > 10) ts = ts / 1000;
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) {
      setTsToDate("✗ 无效时间戳");
      setTsToDateErr(true);
      return;
    }
    const tz =
      d.getTimezoneOffset() <= 0 ? "+" : "-";
    const tzH = String(Math.abs(d.getTimezoneOffset() / 60)).padStart(2, "0");
    setTsToDate(
      d.toLocaleString("zh-CN", { hour12: false }) + "  (UTC" + tz + tzH + ")"
    );
    setTsToDateErr(false);
  };

  const handleTsToTs = (raw: string) => {
    setDateInput(raw);
    if (!raw.trim()) {
      setTsToTs("");
      return;
    }
    const d = new Date(raw.replace(/-/g, "/"));
    if (isNaN(d.getTime())) {
      setTsToTs("✗ 无效日期");
      setTsToTsErr(true);
      return;
    }
    setTsToTs("秒: " + Math.floor(d.getTime() / 1000) + "   毫秒: " + d.getTime());
    setTsToTsErr(false);
  };

  // Unit converter state
  const [unitCategory, setUnitCategory] = useState("length");
  const [unitFromIdx, setUnitFromIdx] = useState(0);
  const [unitToIdx, setUnitToIdx] = useState(1);
  const [unitFromVal, setUnitFromVal] = useState("1");

  const computeUnitResult = useCallback((): string => {
    const val = parseFloat(unitFromVal);
    if (isNaN(val)) return "";
    const units = unitData[unitCategory];
    const fromU = units[unitFromIdx];
    const toU = units[unitToIdx];
    if (!fromU || !toU) return "";
    if (unitCategory === "temperature") {
      const celsius = (val + (fromU.offset || 0)) * fromU.factor;
      const result = celsius / toU.factor - (toU.offset || 0);
      return result.toFixed(4).replace(/\.?0+$/, "");
    }
    const baseVal = val * fromU.factor;
    const result = baseVal / toU.factor;
    return result.toPrecision(10).replace(/\.?0+$/, "");
  }, [unitCategory, unitFromIdx, unitToIdx, unitFromVal]);

  // Color picker state
  const [colorHex, setColorHex] = useState("#4f46e5");
  const colorInputRef = useRef<HTMLInputElement>(null);

  const [colorRgb, setColorRgb] = useState("");
  const [colorHsl, setColorHsl] = useState("");

  const updateColorValues = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    setColorRgb(`rgb(${r}, ${g}, ${b})`);
    const [hh, ss, ll] = rgbToHsl(r, g, b);
    setColorHsl(`hsl(${hh}, ${ss}%, ${ll}%)`);
  };

  useEffect(() => {
    updateColorValues(colorHex);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHexInput = (val: string) => {
    setColorHex(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      if (colorInputRef.current) colorInputRef.current.value = val;
      updateColorValues(val);
    } else if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
      const fixed = val.startsWith("#") ? val : "#" + val;
      setColorHex(fixed);
      if (colorInputRef.current) colorInputRef.current.value = fixed;
      updateColorValues(fixed);
    }
  };

  const handleColorPick = (val: string) => {
    setColorHex(val);
    updateColorValues(val);
  };

  // Case converter state
  const [caseInput, setCaseInput] = useState("");
  const [caseOutput, setCaseOutput] = useState("");

  const handleConvertCase = (mode: string) => {
    setCaseOutput(convertCase(mode, caseInput));
  };

  const currentUnits = unitData[unitCategory] || [];

  return (
    <div className="card-grid tool-card-grid">
      {tools.map((tool) => (
        <article key={tool.id} className="card tool-card" id={tool.id}>
          <div className="tool-header">
            <span className="tool-icon" aria-hidden="true">
              {tool.icon}
            </span>
            <h3>{tool.name}</h3>
          </div>
          <p className="tool-desc">{tool.description}</p>

          {/* JSON Formatter */}
          {tool.id === "json-formatter" && (
            <div className="tool-body">
              <textarea
                className="tool-textarea"
                rows={6}
                placeholder='{"hello":"world","numbers":[1,2,3]}'
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
              />
              <div className="tool-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={jsonFormat}
                >
                  格式化
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={jsonMinify}
                >
                  压缩
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={jsonClear}
                >
                  清空
                </button>
              </div>
              {jsonOutput && (
                <div
                  className={`tool-result ${
                    jsonErr ? "tool-result--err" : "tool-result--ok"
                  }`}
                  aria-live="polite"
                >
                  {jsonOutput}
                </div>
              )}
            </div>
          )}

          {/* Base64 */}
          {tool.id === "base64" && (
            <div className="tool-body">
              <textarea
                className="tool-textarea"
                rows={4}
                placeholder="输入要编码或解码的文本"
                value={b64Input}
                onChange={(e) => setB64Input(e.target.value)}
              />
              <div className="tool-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={b64Encode}
                >
                  编码 →
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={b64Decode}
                >
                  ← 解码
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setB64Input("");
                    setB64Output("");
                  }}
                >
                  清空
                </button>
              </div>
              {b64Output && (
                <div
                  className={`tool-result ${
                    b64Err ? "tool-result--err" : "tool-result--ok"
                  }`}
                  aria-live="polite"
                >
                  {b64Output}
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          {tool.id === "timestamp" && (
            <div className="tool-body">
              <label className="tool-label" htmlFor="ts-now">
                当前时间戳
              </label>
              <div className="ts-now-row">
                <input
                  className="tool-input"
                  id="ts-now"
                  type="text"
                  readOnly
                  value={tsNow}
                />
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={refreshTs}
                >
                  刷新
                </button>
              </div>

              <label className="tool-label" htmlFor="ts-ts-input">
                时间戳 → 日期
              </label>
              <input
                className="tool-input"
                id="ts-ts-input"
                type="text"
                placeholder="例如 1786139195 或 1786139195000"
                value={tsInput}
                onChange={(e) => handleTsToDate(e.target.value)}
              />
              {tsToDate && (
                <div
                  className={`tool-result ${
                    tsToDateErr ? "tool-result--err" : "tool-result--ok"
                  }`}
                  aria-live="polite"
                >
                  {tsToDate}
                </div>
              )}

              <label className="tool-label" htmlFor="ts-date-input">
                日期 → 时间戳
              </label>
              <input
                className="tool-input"
                id="ts-date-input"
                type="text"
                placeholder="例如 2026-08-08 12:00:00"
                value={dateInput}
                onChange={(e) => handleTsToTs(e.target.value)}
              />
              {tsToTs && (
                <div
                  className={`tool-result ${
                    tsToTsErr ? "tool-result--err" : "tool-result--ok"
                  }`}
                  aria-live="polite"
                >
                  {tsToTs}
                </div>
              )}
            </div>
          )}

          {/* Unit Converter */}
          {tool.id === "unit-converter" && (
            <div className="tool-body">
              <div className="tool-row">
                <select
                  className="tool-select"
                  value={unitCategory}
                  onChange={(e) => {
                    setUnitCategory(e.target.value);
                    setUnitFromIdx(0);
                    setUnitToIdx(Math.min(1, unitData[e.target.value].length - 1));
                  }}
                >
                  <option value="length">长度</option>
                  <option value="temperature">温度</option>
                  <option value="data">数据容量</option>
                </select>
              </div>
              <div className="tool-row">
                <input
                  className="tool-input"
                  type="number"
                  value={unitFromVal}
                  onChange={(e) => setUnitFromVal(e.target.value)}
                />
                <select
                  className="tool-select"
                  value={unitFromIdx}
                  onChange={(e) => setUnitFromIdx(parseInt(e.target.value))}
                >
                  {currentUnits.map((u, i) => (
                    <option key={i} value={i}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tool-row">
                <span className="tool-arrow">=</span>
              </div>
              <div className="tool-row">
                <input
                  className="tool-input"
                  type="text"
                  readOnly
                  value={computeUnitResult()}
                />
                <select
                  className="tool-select"
                  value={unitToIdx}
                  onChange={(e) => setUnitToIdx(parseInt(e.target.value))}
                >
                  {currentUnits.map((u, i) => (
                    <option key={i} value={i}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="tool-actions">
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    const tmp = unitFromIdx;
                    setUnitFromIdx(unitToIdx);
                    setUnitToIdx(tmp);
                  }}
                >
                  交换 ⇄
                </button>
              </div>
            </div>
          )}

          {/* Color Picker */}
          {tool.id === "color-picker" && (
            <div className="tool-body">
              <div className="color-row">
                <input
                  ref={colorInputRef}
                  className="color-pick"
                  type="color"
                  value={colorHex}
                  onChange={(e) => handleColorPick(e.target.value)}
                  aria-label="选择颜色"
                />
                <div className="color-values">
                  <div className="color-line">
                    <span className="color-label">HEX</span>
                    <input
                      className="tool-input color-code"
                      type="text"
                      value={colorHex}
                      onChange={(e) => handleHexInput(e.target.value)}
                    />
                  </div>
                  <div className="color-line">
                    <span className="color-label">RGB</span>
                    <input
                      className="tool-input color-code"
                      type="text"
                      readOnly
                      value={colorRgb}
                    />
                  </div>
                  <div className="color-line">
                    <span className="color-label">HSL</span>
                    <input
                      className="tool-input color-code"
                      type="text"
                      readOnly
                      value={colorHsl}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Case Converter */}
          {tool.id === "case-converter" && (
            <div className="tool-body">
              <textarea
                className="tool-textarea"
                rows={3}
                placeholder="输入要转换的文本"
                value={caseInput}
                onChange={(e) => setCaseInput(e.target.value)}
              />
              <div className="tool-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => handleConvertCase("upper")}
                >
                  UPPER
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => handleConvertCase("lower")}
                >
                  lower
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => handleConvertCase("title")}
                >
                  Title
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => handleConvertCase("camel")}
                >
                  camelCase
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => handleConvertCase("snake")}
                >
                  snake_case
                </button>
              </div>
              {caseOutput && (
                <div className="tool-result tool-result--ok" aria-live="polite">
                  {caseOutput}
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
