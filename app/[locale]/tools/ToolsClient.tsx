"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, cx } from "../components/ui";

const JsonFormatter = dynamic(() => import("./components/JsonFormatter"), { ssr: false });
const Base64Tool = dynamic(() => import("./components/Base64Tool"), { ssr: false });
const TimestampTool = dynamic(() => import("./components/TimestampTool"), { ssr: false });
const UnitConverter = dynamic(() => import("./components/UnitConverter"), { ssr: false });
const ColorPicker = dynamic(() => import("./components/ColorPicker"), { ssr: false });
const CaseConverter = dynamic(() => import("./components/CaseConverter"), { ssr: false });

/** Interactive client components keyed by tool id. */
const COMPONENTS: Record<string, ComponentType | undefined> = {
  "json-formatter": JsonFormatter,
  base64: Base64Tool,
  timestamp: TimestampTool,
  "unit-converter": UnitConverter,
  "color-picker": ColorPicker,
  "case-converter": CaseConverter,
};

// http-check renders on the server (it needs request headers), so it only
// gets a jump link here instead of an embedded component.
const tools = [
  { id: "json-formatter", icon: "json", key: "json" },
  { id: "base64", icon: "b64", key: "base64" },
  { id: "timestamp", icon: "ts", key: "timestamp" },
  { id: "unit-converter", icon: "unit", key: "unit" },
  { id: "color-picker", icon: "color", key: "color" },
  { id: "case-converter", icon: "case", key: "case" },
  { id: "http-check", icon: "http", key: "httpCheck" },
];

export default function ToolsPage() {
  const t = useTranslations("tools");

  return (
    <div className="card-grid tool-card-grid">
      {tools.map((tool) => {
        const Component = COMPONENTS[tool.id];
        return (
          <Card key={tool.id} as="article" className="tool-card" id={tool.id}>
            <div className="tool-header">
              <span className="tool-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <h3>{t(`items.${tool.key}.name`)}</h3>
            </div>
            <p className="tool-desc">{t(`items.${tool.key}.description`)}</p>
            {Component ? (
              <Component />
            ) : (
              <Link
                href={`/tools/${tool.id}`}
                className={cx("btn", "btn--primary", "btn--sm")}
              >
                {t("actions.open")}
              </Link>
            )}
          </Card>
        );
      })}
    </div>
  );
}
