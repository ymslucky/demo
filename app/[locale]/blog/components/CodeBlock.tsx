"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CodeBlock({ code, language = "java", title }: CodeBlockProps) {
  const t = useTranslations("blog.codeBlock");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code: ", err);
    }
  };

  const lines = code.trim().split("\n");

  return (
    <div className="blog-code-block">
      {/* 顶栏：mac 风格圆点 + 标题 + 复制操作 */}
      <div className="blog-code-block-bar">
        <div className="blog-code-block-left">
          <div className="blog-code-block-dots" aria-hidden="true">
            <span className="blog-code-block-dot blog-code-block-dot--err" />
            <span className="blog-code-block-dot blog-code-block-dot--warn" />
            <span className="blog-code-block-dot blog-code-block-dot--ok" />
          </div>
          <span className="blog-code-block-title">
            {title ?? language.toUpperCase()}
          </span>
        </div>
        <button
          type="button"
          className="blog-code-block-copy"
          onClick={handleCopy}
          title={t("copyCode")}
          aria-label={t("copyCode")}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>

      {/* 代码区：行号栏 + 预格式化源码 */}
      <div className="blog-code-block-body">
        <div className="blog-code-block-gutter" aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i + 1}>{i + 1}</span>
          ))}
        </div>
        <pre className="blog-code-block-pre">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="blog-code-block-line">
                {highlightTokens(line)}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * 内联 SVG 图标（替代 lucide-react，零依赖）：
 * 24 网格描边风格，颜色继承 currentColor，仅供本文件的复制按钮使用。
 */
function CheckIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/**
 * 轻量级自定义语法高亮器，用于基础的 Java/C 风格代码片段。
 * 返回 React 节点数组（携带 token 类名的 span），以规避 XSS 风险。
 * token 的配色定义在 components.css（.tok-*）中。
 */
function highlightTokens(line: string) {
  if (!line.trim()) return " ";

  // 整行按单行注释处理
  if (line.trim().startsWith("//")) {
    return <span className="tok-comment">{line}</span>;
  }

  // 所给代码片段中的常见关键字
  const keywords = new Set([
    'class', 'final', 'synchronized', 'boolean', 'long', 'int', 'double',
    'if', 'else', 'while', 'return', 'new', 'public', 'private', 'true', 'false'
  ]);

  // 内置类 / 对象
  const builtIns = new Set([
    'System', 'Math', 'Queue', 'LinkedList', 'currentTimeMillis', 'min'
  ]);

  // 按单词边界分词，符号保持原样。
  const tokens = line.split(/(\b\w+\b|[^\w\s]|\s+)/g).filter(Boolean);

  return tokens.map((token, index) => {
    // 关键字
    if (keywords.has(token)) {
      return <span key={index} className="tok-kw">{token}</span>;
    }
    // 数字
    if (!isNaN(Number(token)) && token.trim() !== '') {
      return <span key={index} className="tok-num">{token}</span>;
    }
    // 内置类/对象
    if (builtIns.has(token)) {
      return <span key={index} className="tok-builtin">{token}</span>;
    }

    // 默认文本
    return <span key={index}>{token}</span>;
  });
}
