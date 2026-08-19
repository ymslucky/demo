import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default async function CodeBlock({ code, language = "java", title }: CodeBlockProps) {
  // Use Shiki to generate HTML with inline styles
  const html = await codeToHtml(code, {
    lang: language,
    theme: 'vitesse-dark', // High contrast dark theme, fits well with Neo-Brutalism
  });

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
      <div 
        className="code-wrapper"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
