"use client";

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CodeBlock({ code, language = "java", title }: CodeBlockProps) {
  return (
    <div className="border-4 border-border rounded-lg overflow-hidden my-8 shadow-[4px_4px_0px_0px_var(--color-border)]">
      <div className="bg-surface border-b-4 border-border px-4 py-2 flex items-center justify-between">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-err-text border-2 border-border"></div>
          <div className="w-3 h-3 rounded-full bg-warn-text border-2 border-border"></div>
          <div className="w-3 h-3 rounded-full bg-info-text border-2 border-border"></div>
        </div>
        {title && <span className="font-mono text-xs font-bold text-text-muted">{title}</span>}
      </div>
      <SyntaxHighlighter 
        language={language} 
        style={tomorrow}
        customStyle={{ 
          margin: 0, 
          padding: '1.5rem', 
          background: 'var(--color-bg)', 
          fontSize: '14px',
          lineHeight: '1.5',
          fontFamily: 'var(--font-mono)'
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
