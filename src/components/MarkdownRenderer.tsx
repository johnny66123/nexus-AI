import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const key = `${match.index}-${raw.length}`;
    if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code
          key={key}
          className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[13px] text-blue-300 border border-slate-700/60"
        >
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push(
        <strong key={key} className="font-semibold text-slate-100">
          {raw.slice(2, -2)}
        </strong>,
      );
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push(
        <em key={key} className="italic text-slate-200">
          {raw.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-800 bg-[#050811]">
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#0B1120] px-3.5 py-2 text-xs text-slate-400">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed text-slate-200">
      {segments.map((segment, segIdx) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const language = firstNewline !== -1 ? inner.slice(0, firstNewline).trim() : '';
          const code = firstNewline !== -1 ? inner.slice(firstNewline + 1) : inner;
          return <CodeBlock key={segIdx} language={language} code={code} />;
        }

        const lines = segment.split('\n');
        const blocks: React.ReactNode[] = [];
        let listItems: { ordered: boolean; text: string }[] = [];

        const flushList = (keyBase: string) => {
          if (listItems.length === 0) return;
          const ordered = listItems[0].ordered;
          const Tag = ordered ? 'ol' : 'ul';
          blocks.push(
            <Tag
              key={keyBase}
              className={`my-2 space-y-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} text-slate-200`}
            >
              {listItems.map((item, idx) => (
                <li key={idx} className="leading-relaxed">
                  {renderInlineFormatting(item.text)}
                </li>
              ))}
            </Tag>,
          );
          listItems = [];
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();
          const key = `${segIdx}-${lineIdx}`;

          const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed);
          const numberedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);

          if (bulletMatch) {
            if (listItems.length > 0 && listItems[0].ordered) flushList(`${key}-flush`);
            listItems.push({ ordered: false, text: bulletMatch[1] });
            return;
          }

          if (numberedMatch) {
            if (listItems.length > 0 && !listItems[0].ordered) flushList(`${key}-flush`);
            listItems.push({ ordered: true, text: numberedMatch[1] });
            return;
          }

          flushList(`${key}-flush`);

          if (!trimmed) return;

          if (trimmed.startsWith('### ')) {
            blocks.push(
              <h4 key={key} className="pt-2 font-display text-base font-semibold text-white">
                {renderInlineFormatting(trimmed.slice(4))}
              </h4>,
            );
          } else if (trimmed.startsWith('## ')) {
            blocks.push(
              <h3 key={key} className="pt-2 font-display text-lg font-semibold text-white">
                {renderInlineFormatting(trimmed.slice(3))}
              </h3>,
            );
          } else if (trimmed.startsWith('# ')) {
            blocks.push(
              <h2 key={key} className="pt-2 font-display text-xl font-semibold text-white">
                {renderInlineFormatting(trimmed.slice(2))}
              </h2>,
            );
          } else if (trimmed.startsWith('> ')) {
            blocks.push(
              <div
                key={key}
                className="rounded-lg border border-slate-800 bg-[#0B1120] px-4 py-2.5 text-sm text-slate-300"
              >
                {renderInlineFormatting(trimmed.slice(2))}
              </div>,
            );
          } else {
            blocks.push(
              <p key={key} className="leading-relaxed text-slate-200">
                {renderInlineFormatting(trimmed)}
              </p>,
            );
          }
        });

        flushList(`${segIdx}-end`);

        return <div key={segIdx} className="space-y-2">{blocks}</div>;
      })}
    </div>
  );
}
