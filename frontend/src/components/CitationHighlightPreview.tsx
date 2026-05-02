'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { extractReferences, type ReferenceLink } from '@/lib/citationCheck';

type Props = {
  content: string;
};

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullet-list'; items: string[] };

function stripSourcesSection(content: string): string {
  return content.replace(/(?:\n|^)##\s+(?:sources|references)\b[\s\S]*$/i, '').trim();
}

function buildRefMap(refs: ReferenceLink[]): Map<string, ReferenceLink> {
  return new Map(refs.map((ref) => [ref.marker, ref]));
}

function parseBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let bulletItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushBullets = (): void => {
    if (bulletItems.length > 0) {
      blocks.push({ kind: 'bullet-list', items: [...bulletItems] });
      bulletItems = [];
    }
  };

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: 'paragraph', lines: [...paragraphLines] });
      paragraphLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushBullets();
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: 'h3', text: trimmed.slice(4) });
    } else if (trimmed.startsWith('## ')) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: 'h2', text: trimmed.slice(3) });
    } else if (trimmed.startsWith('# ')) {
      flushBullets();
      flushParagraph();
      blocks.push({ kind: 'h1', text: trimmed.slice(2) });
    } else if (/^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
      flushParagraph();
      const itemText = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
      bulletItems.push(itemText);
    } else {
      flushBullets();
      paragraphLines.push(trimmed);
    }
  }

  flushBullets();
  flushParagraph();
  return blocks;
}

function splitIntoSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?]) +/);
  return parts.filter(Boolean);
}

function getValidRefs(text: string, refMap: Map<string, ReferenceLink>): ReferenceLink[] {
  return [...text.matchAll(/\[\d+\]/g)]
    .map((m) => refMap.get(m[0]))
    .filter((r): r is ReferenceLink => Boolean(r));
}

function renderInlineSegments(text: string, refMap: Map<string, ReferenceLink>): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    if (/^\[\d+\]$/.test(part)) {
      const ref = refMap.get(part);
      if (ref) {
        return (
          <a
            key={i}
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-0.5 inline-block align-super text-[10px] font-bold text-blue-600 no-underline hover:text-blue-800"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return (
        <sup key={i} className="text-[10px] text-slate-400">
          {part}
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function CitedSentence({ sentence, refMap }: { sentence: string; refMap: Map<string, ReferenceLink> }) {
  const [open, setOpen] = useState(false);
  const refs = getValidRefs(sentence, refMap);

  return (
    <span
      className="relative rounded bg-amber-50 px-0.5 ring-1 ring-amber-200"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {renderInlineSegments(sentence, refMap)}
      {open && refs.length > 0 && (
        <span className="absolute bottom-full left-0 z-50 mb-1.5 block min-w-[220px] max-w-xs rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Source{refs.length > 1 ? 's' : ''}
          </span>
          {refs.map((ref) => (
            <a
              key={ref.url}
              href={ref.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all py-0.5 text-xs text-blue-700 hover:underline"
            >
              {ref.label ?? ref.url}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}

function renderTextWithCitations(text: string, refMap: Map<string, ReferenceLink>, keyPrefix: string): ReactNode {
  if (!text.match(/\[\d+\]/)) {
    return <span key={keyPrefix}>{text}</span>;
  }

  const sentences = splitIntoSentences(text);

  return (
    <Fragment key={keyPrefix}>
      {sentences.map((sentence, i) => {
        const isLast = i === sentences.length - 1;
        const refs = getValidRefs(sentence, refMap);

        if (refs.length > 0) {
          return (
            <Fragment key={`${keyPrefix}-s${i}`}>
              <CitedSentence sentence={sentence} refMap={refMap} />
              {!isLast && ' '}
            </Fragment>
          );
        }

        return (
          <Fragment key={`${keyPrefix}-s${i}`}>
            <span>{renderInlineSegments(sentence, refMap)}</span>
            {!isLast && ' '}
          </Fragment>
        );
      })}
    </Fragment>
  );
}

function renderBlock(block: Block, refMap: Map<string, ReferenceLink>, index: number): ReactNode {
  switch (block.kind) {
    case 'h1':
      return (
        <h1 key={index} className="mb-3 mt-1 text-xl font-bold text-slate-900">
          {block.text}
        </h1>
      );
    case 'h2':
      return (
        <h2 key={index} className="mb-2 mt-5 text-base font-bold text-slate-900 first:mt-0">
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 key={index} className="mb-1 mt-3 text-sm font-bold text-slate-800">
          {block.text}
        </h3>
      );
    case 'paragraph':
      return (
        <p key={index} className="mb-3 text-sm leading-relaxed text-slate-800">
          {block.lines.map((line, li) => (
            <Fragment key={li}>
              {li > 0 && ' '}
              {renderTextWithCitations(line, refMap, `${index}-line-${li}`)}
            </Fragment>
          ))}
        </p>
      );
    case 'bullet-list':
      return (
        <ul key={index} className="mb-3 ml-5 list-disc space-y-1">
          {block.items.map((item, ii) => (
            <li key={ii} className="text-sm leading-relaxed text-slate-800">
              {renderTextWithCitations(item, refMap, `${index}-item-${ii}`)}
            </li>
          ))}
        </ul>
      );
  }
}

export function CitationHighlightPreview({ content }: Props) {
  const refs = useMemo(() => extractReferences(content), [content]);
  const refMap = useMemo(() => buildRefMap(refs), [refs]);
  const body = useMemo(() => stripSourcesSection(content), [content]);
  const blocks = useMemo(() => parseBlocks(body), [body]);

  if (!content.trim()) {
    return <p className="text-sm italic text-slate-400">No content to preview.</p>;
  }

  return (
    <div>
      <div className="leading-relaxed">
        {blocks.map((block, i) => renderBlock(block, refMap, i))}
      </div>

      {refs.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</h3>
          <ul className="space-y-1.5">
            {refs.map((ref) => (
              <li key={ref.url} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 font-semibold text-slate-500">{ref.marker}</span>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-blue-700 hover:underline"
                >
                  {ref.label ?? ref.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
