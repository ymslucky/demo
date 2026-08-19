"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { unitData, convertUnit } from "../utils";
import { useStickyState } from "./useStickyState";

export default function UnitConverter() {
  const t = useTranslations("tools");
  const tu = useTranslations("unit");

  const [unitCategory, setUnitCategory] = useStickyState("length", "unitCategory");
  const [unitFromIdx, setUnitFromIdx] = useStickyState(0, "unitFromIdx");
  const [unitToIdx, setUnitToIdx] = useStickyState(1, "unitToIdx");
  const [unitFromVal, setUnitFromVal] = useStickyState("1", "unitFromVal");

  const unitResult = useMemo(
    () => convertUnit(unitCategory, unitFromIdx, unitToIdx, unitFromVal),
    [unitCategory, unitFromIdx, unitToIdx, unitFromVal]
  );

  const swapUnits = () => {
    setUnitFromIdx(unitToIdx);
    setUnitToIdx(unitFromIdx);
  };

  const changeUnitCategory = (category: string) => {
    setUnitCategory(category);
    setUnitFromIdx(0);
    setUnitToIdx(Math.min(1, unitData[category].length - 1));
  };

  const currentUnits = unitData[unitCategory] || [];

  return (
    <div className="tool-body">
      <div className="tool-row">
        <label className="sr-only" htmlFor="unit-category">
          {t("labels.unitType")}
        </label>
        <select
          id="unit-category"
          className="tool-select"
          value={unitCategory}
          onChange={(e) => changeUnitCategory(e.target.value)}
        >
          <option value="length">{t("labels.categoryLength")}</option>
          <option value="temperature">
            {t("labels.categoryTemperature")}
          </option>
          <option value="data">{t("labels.categoryData")}</option>
        </select>
      </div>
      <div className="tool-row">
        <label className="sr-only" htmlFor="unit-from-val">
          {t("labels.inputValue")}
        </label>
        <input
          id="unit-from-val"
          className="tool-input"
          type="number"
          value={unitFromVal}
          onChange={(e) => setUnitFromVal(e.target.value)}
        />
        <label className="sr-only" htmlFor="unit-from-unit">
          {t("labels.sourceUnit")}
        </label>
        <select
          id="unit-from-unit"
          className="tool-select"
          value={unitFromIdx}
          onChange={(e) => setUnitFromIdx(parseInt(e.target.value))}
        >
          {currentUnits.map((u, i) => (
            <option key={i} value={i}>
              {tu(`${unitCategory}.${u.label}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="tool-row">
        <span className="tool-arrow">=</span>
      </div>
      <div className="tool-row">
        <label className="sr-only" htmlFor="unit-to-val">
          {t("labels.result")}
        </label>
        <input
          id="unit-to-val"
          className="tool-input"
          type="text"
          readOnly
          value={unitResult}
        />
        <label className="sr-only" htmlFor="unit-to-unit">
          {t("labels.targetUnit")}
        </label>
        <select
          id="unit-to-unit"
          className="tool-select"
          value={unitToIdx}
          onChange={(e) => setUnitToIdx(parseInt(e.target.value))}
        >
          {currentUnits.map((u, i) => (
            <option key={i} value={i}>
              {tu(`${unitCategory}.${u.label}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="tool-actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={swapUnits}
        >
          {t("actions.swap")}
        </button>
      </div>
    </div>
  );
}
