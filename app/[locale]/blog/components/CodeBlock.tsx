"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";

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
      {/* Header bar: mac-style dots + title + copy action */}
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
          {copied ? (
            <Check size={16} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <Copy size={16} strokeWidth={2.5} aria-hidden="true" />
          )}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>

      {/* Code area: line-number gutter + preformatted source */}
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
 * Lightweight custom syntax highlighter for basic Java/C-like snippets.
 * Returns an array of React nodes (spans with token classes) to keep it
 * safe from XSS. Token colors live in components.css (.tok-*).
 */
function highlightTokens(line: string) {
  if (!line.trim()) return " ";

  // Handle single-line comments entirely
  if (line.trim().startsWith("//")) {
    return <span className="tok-comment">{line}</span>;
  }

  // Common keywords in the provided snippets
  const keywords = new Set([
    'class', 'final', 'synchronized', 'boolean', 'long', 'int', 'double',
    'if', 'else', 'while', 'return', 'new', 'public', 'private', 'true', 'false'
  ]);

  // Built-in classes / Objects
  const builtIns = new Set([
    'System', 'Math', 'Queue', 'LinkedList', 'currentTimeMillis', 'min'
  ]);

  // Tokenize by word boundaries, keeping symbols intact.
  const tokens = line.split(/(\b\w+\b|[^\w\s]|\s+)/g).filter(Boolean);

  return tokens.map((token, index) => {
    // Keywords
    if (keywords.has(token)) {
      return <span key={index} className="tok-kw">{token}</span>;
    }
    // Numbers
    if (!isNaN(Number(token)) && token.trim() !== '') {
      return <span key={index} className="tok-num">{token}</span>;
    }
    // Built-ins
    if (builtIns.has(token)) {
      return <span key={index} className="tok-builtin">{token}</span>;
    }

    // Default text
    return <span key={index}>{token}</span>;
  });
}
