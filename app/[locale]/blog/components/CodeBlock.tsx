"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CodeBlock({ code, language = "java", title }: CodeBlockProps) {
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
    <div className="border-4 border-border rounded-xl overflow-hidden my-8 shadow-[4px_4px_0px_0px_var(--color-border)] bg-surface flex flex-col">
      {/* Header Bar */}
      <div className="bg-tint border-b-4 border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Mac-like Window Controls */}
          <div className="flex gap-2">
            <div className="w-3.5 h-3.5 rounded-full bg-err-text border-2 border-border shadow-[1px_1px_0px_0px_rgba(0,0,0,0.2)]"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-warn-text border-2 border-border shadow-[1px_1px_0px_0px_rgba(0,0,0,0.2)]"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-info-text border-2 border-border shadow-[1px_1px_0px_0px_rgba(0,0,0,0.2)]"></div>
          </div>
          {/* Title or Language Label */}
          {title ? (
            <span className="font-mono text-sm font-bold text-text-muted">{title}</span>
          ) : (
            <span className="font-mono text-sm font-bold text-text-muted uppercase">{language}</span>
          )}
        </div>
        
        {/* Copy Button */}
        <button 
          onClick={handleCopy}
          className="px-2 py-1 rounded-md hover:bg-surface border-2 border-transparent hover:border-border transition-all flex items-center gap-1 text-xs font-bold text-text-muted hover:text-text hover:shadow-[2px_2px_0px_0px_var(--color-border)]"
          title="Copy code to clipboard"
          aria-label="Copy code"
        >
          {copied ? <Check className="w-4 h-4 text-info-text" /> : <Copy className="w-4 h-4" />}
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      
      {/* Code Display Area */}
      <div className="flex bg-bg overflow-auto relative">
        {/* Line Numbers */}
        <div 
          className="flex flex-col text-right px-4 py-4 bg-surface border-r-2 border-border select-none font-mono text-sm"
          style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
        >
          {lines.map((_, i) => (
            <span key={i + 1} className="leading-[1.6]">{i + 1}</span>
          ))}
        </div>
        
        {/* Source Code Content */}
        <pre className="p-4 m-0 overflow-x-auto w-full">
          <code className="font-mono text-sm text-text whitespace-pre block" style={{ lineHeight: '1.6' }}>
            {lines.map((line, i) => (
              <div key={i} className="min-h-[1.6em]">{highlightTokens(line)}</div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * Lightweight custom syntax highlighter for basic Java/C-like snippets
 * Returns an array of React nodes (spans with colors) to keep it safe from XSS.
 */
function highlightTokens(line: string) {
  if (!line.trim()) return " ";

  // Handle single-line comments entirely
  if (line.trim().startsWith("//")) {
    return <span className="text-text-muted italic">{line}</span>;
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
    // Keywords (Purple/Primary)
    if (keywords.has(token)) {
      return <span key={index} className="text-primary font-bold">{token}</span>;
    }
    // Numbers (Teal/Info)
    if (!isNaN(Number(token)) && token.trim() !== '') {
      return <span key={index} className="text-info-text font-bold">{token}</span>;
    }
    // Built-ins (Orange/Warn)
    if (builtIns.has(token)) {
      return <span key={index} className="text-warn-text font-bold">{token}</span>;
    }
    // Methods / Functions (when followed by parenthesis - naive check)
    // For a simple split, this is harder, so we just fallback to normal text
    
    // Default text
    return <span key={index}>{token}</span>;
  });
}
