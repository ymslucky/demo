"use client";

import { useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  hexToRgb,
  rgbToHsl,
  getColorStrings,
  contrastRatio,
  expandShortHex,
  wcagLevel,
  isHexColor,
  pushColorHistory,
} from "../utils";
import { useStickyState } from "./useStickyState";
import { Input } from "../../components/ui";
import { ToolShell } from "./ToolShell";
import { CopyButton } from "./CopyButton";

export default function ColorPicker() {
  const t = useTranslations("tools");
  const [colorHex, setColorHex] = useStickyState("#4f46e5", "colorHex");
  const colorInputRef = useRef<HTMLInputElement>(null);

  const initialRgb = (() => {
    const [r, g, b] = hexToRgb("#4f46e5");
    return `rgb(${r}, ${g}, ${b})`;
  })();
  const [colorRgb, setColorRgb] = useStickyState(initialRgb, "colorRgb");

  const initialHsl = (() => {
    const [r, g, b] = hexToRgb("#4f46e5");
    const [h, s, l] = rgbToHsl(r, g, b);
    return `hsl(${h}, ${s}%, ${l}%)`;
  })();
  const [colorHsl, setColorHsl] = useStickyState(initialHsl, "colorHsl");
  const [colorHistory, setColorHistory] = useStickyState<string[]>([], "colorHistory");

  // 挂载时将 ref 与 sticky state 同步
  useEffect(() => {
    if (colorInputRef.current) {
      colorInputRef.current.value = colorHex;
    }
  }, [colorHex]);

  const updateColorValues = useCallback((hex: string) => {
    const { rgb, hsl } = getColorStrings(hex);
    setColorRgb(rgb);
    setColorHsl(hsl);
  }, [setColorRgb, setColorHsl]);

  const handleHexInput = (val: string) => {
    setColorHex(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      if (colorInputRef.current) colorInputRef.current.value = val;
      updateColorValues(val);
      setColorHistory((prev) => pushColorHistory(prev, val));
    } else if (/^#?[0-9a-fA-F]{6}$/.test(val)) {
      const fixed = val.startsWith("#") ? val : "#" + val;
      setColorHex(fixed);
      if (colorInputRef.current) colorInputRef.current.value = fixed;
      updateColorValues(fixed);
      setColorHistory((prev) => pushColorHistory(prev, fixed));
    }
  };

  // localStorage 读取防御：只渲染规范 6 位 hex，历史键可能来自旧版本数据。
  const safeHistory = colorHistory.filter(isHexColor);

  // 十六进制合法时的对比度（对白底 / 黑底），非法输入显示占位。
  const validHex = /^#[0-9a-fA-F]{6}$/.test(colorHex);
  const ratioWhite = validHex ? contrastRatio(hexToRgb(colorHex), [255, 255, 255]) : null;
  const ratioBlack = validHex ? contrastRatio(hexToRgb(colorHex), [0, 0, 0]) : null;
  const contrastWhite = ratioWhite === null ? "—" : ratioWhite.toFixed(2) + ":1 · " + wcagLevel(ratioWhite);
  const contrastBlack = ratioBlack === null ? "—" : ratioBlack.toFixed(2) + ":1 · " + wcagLevel(ratioBlack);

  const handleColorPick = (val: string) => {
    setColorHex(val);
    updateColorValues(val);
    setColorHistory((prev) => pushColorHistory(prev, val));
  };

  return (
    <ToolShell>
      <div className="color-row">
        <input
          ref={colorInputRef}
          className="color-pick"
          type="color"
          value={colorHex}
          onChange={(e) => handleColorPick(e.target.value)}
          aria-label={t("labels.pickColor")}
        />
        <div className="color-values">
          <div className="color-line">
            <label className="color-label" htmlFor="color-hex">
              {t("labels.hex")}
            </label>
            <Input
              id="color-hex"
              className="color-code"
              type="text"
              value={colorHex}
              onChange={(e) => handleHexInput(e.target.value)}
              onBlur={() => {
                // 失焦时展开 #abc 短格式（输入中展开会干扰 6 位输入）。
                if (/^#[0-9a-fA-F]{3}$/.test(colorHex)) {
                  const full = expandShortHex(colorHex);
                  setColorHex(full);
                  if (colorInputRef.current) colorInputRef.current.value = full;
                  updateColorValues(full);
                  setColorHistory((prev) => pushColorHistory(prev, full));
                }
              }}
            />
            <CopyButton value={colorHex} />
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.rgb")}</span>
            <Input
              className="color-code"
              type="text"
              readOnly
              value={colorRgb}
              aria-label={t("labels.rgbValue")}
            />
            <CopyButton value={colorRgb} />
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.hsl")}</span>
            <Input
              className="color-code"
              type="text"
              readOnly
              value={colorHsl}
              aria-label={t("labels.hslValue")}
            />
            <CopyButton value={colorHsl} />
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.contrastWhite")}</span>
            <span className="color-contrast">{contrastWhite}</span>
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.contrastBlack")}</span>
            <span className="color-contrast">{contrastBlack}</span>
          </div>
        </div>
      </div>
      {safeHistory.length > 0 ? (
        <div className="color-history">
          {safeHistory.map((hex) => (
            <button
              key={hex}
              type="button"
              className="color-history-item"
              style={{ background: hex }}
              onClick={() => handleColorPick(hex)}
              aria-label={t("labels.historyColor", { color: hex })}
            />
          ))}
        </div>
      ) : null}
    </ToolShell>
  );
}
