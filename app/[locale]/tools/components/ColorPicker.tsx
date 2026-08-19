"use client";

import { useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { hexToRgb, rgbToHsl, getColorStrings } from "../utils";
import { useStickyState } from "./useStickyState";

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

  // Sync ref with sticky state on mount
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

  return (
    <div className="tool-body">
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
            <input
              id="color-hex"
              className="tool-input color-code"
              type="text"
              value={colorHex}
              onChange={(e) => handleHexInput(e.target.value)}
            />
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.rgb")}</span>
            <input
              className="tool-input color-code"
              type="text"
              readOnly
              value={colorRgb}
              aria-label={t("labels.rgbValue")}
            />
          </div>
          <div className="color-line">
            <span className="color-label">{t("labels.hsl")}</span>
            <input
              className="tool-input color-code"
              type="text"
              readOnly
              value={colorHsl}
              aria-label={t("labels.hslValue")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
