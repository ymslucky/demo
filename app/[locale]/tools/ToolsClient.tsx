"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useTiltGrid } from "./useTiltGrid";

// http-check 渲染服务端数据、counter 需要登录门控，六个本地工具也已
// 迁入各自二级页面 —— 首页是纯陈列目录：卡片提供活体预览与跳转，
// 具体使用一律在二级页面完成。（数组字面量内不能写注释：i18n 契约
// 测试会把本数组当作 JSON 解析。）
const tools = [
  { id: "json-formatter", icon: "{}", key: "json" },
  { id: "base64", icon: "b64", key: "base64" },
  { id: "timestamp", icon: "ts", key: "timestamp" },
  { id: "unit-converter", icon: "unit", key: "unit" },
  { id: "case-converter", icon: "Aa", key: "case" },
  { id: "color-picker", icon: "rgb", key: "color" },
  { id: "http-check", icon: "http", key: "httpCheck" },
  { id: "todo-list", icon: "✓", key: "todo" },
];

/** 每张卡片的装饰性活体预览 —— 纯 CSS 动画，运行时零 JS。 */
function ShowcasePreview({ id }: { id: string }) {
  if (id === "json-formatter") {
    return (
      <span className="showcase-preview" aria-hidden="true">
        <span className="pv-window">
          <span className="pv-line pv-line--key" />
          <span className="pv-line pv-line--str" />
          <span className="pv-line pv-line--num" />
        </span>
      </span>
    );
  }
  if (id === "timestamp") {
    return (
      <span className="showcase-preview" aria-hidden="true">
        <span className="pv-mono pv-digits">1710000000</span>
        <span className="pv-scan">
          <span className="pv-scan-bar" />
        </span>
      </span>
    );
  }
  if (id === "color-picker") {
    return (
      <span className="showcase-preview" aria-hidden="true">
        <span className="pv-swatches">
          <span className="pv-swatch pv-swatch--a" />
          <span className="pv-swatch pv-swatch--b" />
          <span className="pv-swatch pv-swatch--c" />
        </span>
      </span>
    );
  }
  if (id === "http-check") {
    return (
      <span className="showcase-preview" aria-hidden="true">
        <span className="pv-badges">
          <span className="pv-badge pv-badge--ok">200</span>
          <span className="pv-badge pv-badge--warn">404</span>
          <span className="pv-badge pv-badge--err">500</span>
        </span>
      </span>
    );
  }
  if (id === "todo-list") {
    return (
      <span className="showcase-preview" aria-hidden="true">
        <span className="pv-todos">
          <span className="pv-todo">
            <span className="pv-todo-box" />
            <span className="pv-todo-line" />
          </span>
          <span className="pv-todo">
            <span className="pv-todo-box" />
            <span className="pv-todo-line" />
          </span>
        </span>
      </span>
    );
  }
  // base64 / unit-converter / case-converter 共用双面翻转样式
  const faces: Record<string, [string, string]> = {
    base64: ["Aa", "QQ=="],
    "unit-converter": ["1 m", "3.28 ft"],
    "case-converter": ["hello", "HELLO"],
    "code-sandbox": ["print(1)", "=> 2"],
  };
  const [front, back] = faces[id] ?? ["", ""];
  return (
    <span className="showcase-preview" aria-hidden="true">
      <span className="pv-swap">
        <span className="pv-face pv-mono">{front}</span>
        <span className="pv-face pv-mono">{back}</span>
      </span>
    </span>
  );
}

export default function ToolsPage() {
  const t = useTranslations("tools");
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  useTiltGrid(gridRef, cardRefs);

  return (
    <div className="showcase-grid" ref={gridRef}>
      {tools.map((tool, i) => (
        <Link
          key={tool.id}
          href={`/tools/${tool.id}`}
          prefetch={false}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
          className={
            tool.id === "json-formatter"
              ? "showcase-card showcase-card--feature"
              : "showcase-card"
          }
          style={{ "--i": i } as React.CSSProperties}
        >
          <span className="showcase-index" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="tool-icon" aria-hidden="true">
            {tool.icon}
          </span>
          <h3 className="showcase-name">{t(`items.${tool.key}.name`)}</h3>
          <p className="showcase-desc">{t(`items.${tool.key}.description`)}</p>
          <ShowcasePreview id={tool.id} />
          <span className="showcase-cta" aria-hidden="true">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}
