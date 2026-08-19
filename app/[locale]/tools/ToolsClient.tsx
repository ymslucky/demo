"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

const JsonFormatter = dynamic(() => import("./components/JsonFormatter"), { ssr: false });
const Base64Tool = dynamic(() => import("./components/Base64Tool"), { ssr: false });
const TimestampTool = dynamic(() => import("./components/TimestampTool"), { ssr: false });
const UnitConverter = dynamic(() => import("./components/UnitConverter"), { ssr: false });
const ColorPicker = dynamic(() => import("./components/ColorPicker"), { ssr: false });
const CaseConverter = dynamic(() => import("./components/CaseConverter"), { ssr: false });

// ---- Tool catalogue ----
const tools = [
  { id: "json-formatter", icon: "json", key: "json", Component: JsonFormatter },
  { id: "base64", icon: "b64", key: "base64", Component: Base64Tool },
  { id: "timestamp", icon: "ts", key: "timestamp", Component: TimestampTool },
  { id: "unit-converter", icon: "unit", key: "unit", Component: UnitConverter },
  { id: "color-picker", icon: "color", key: "color", Component: ColorPicker },
  { id: "case-converter", icon: "case", key: "case", Component: CaseConverter },
] as const;

export default function ToolsPage() {
  const t = useTranslations("tools");

  return (
    <div className="card-grid tool-card-grid">
      {tools.map((tool) => {
        const { Component } = tool;
        return (
          <article key={tool.id} className="card tool-card" id={tool.id}>
            <div className="tool-header">
              <span className="tool-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <h3>{t(`items.${tool.key}.name`)}</h3>
            </div>
            <p className="tool-desc">{t(`items.${tool.key}.description`)}</p>
            <Component />
          </article>
        );
      })}
    </div>
  );
}
