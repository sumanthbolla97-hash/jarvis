
import React from 'react';
import { TranscriptionItem } from '../types';

interface ResponseDisplayProps {
  item: TranscriptionItem;
}

const ResponseDisplay: React.FC<ResponseDisplayProps> = ({ item }) => {
  const normalizeForCompare = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const isNearDuplicate = (a: string, b: string): boolean => {
    const na = normalizeForCompare(a);
    const nb = normalizeForCompare(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    const tokensA = new Set(na.split(' '));
    const tokensB = new Set(nb.split(' '));
    const common = [...tokensA].filter((t) => tokensB.has(t)).length;
    const minSize = Math.max(1, Math.min(tokensA.size, tokensB.size));
    return common / minSize >= 0.8;
  };

  const dedupeTechnicalDefinition = (text: string): string => {
    const paragraphs = text
      .split('\n\n')
      .map((p) => p.trim())
      .filter((p) => p && !/^(or|or\.|or,)\s*$/i.test(p));

    const kept: string[] = [];
    for (const para of paragraphs) {
      const isDup = kept.some((existing) => isNearDuplicate(existing, para));
      if (!isDup) kept.push(para);
    }
    return kept.join('\n\n');
  };

  const extractSections = (text: string) => {
    const sections: Record<string, string> = {
      TECHNICAL_DEFINITION: '',
      EXPLANATION: '',
      EXAMPLES: '',
      FLOW_DIAGRAM: '',
    };

    const markerRegex = /\[(TECHNICAL_DEFINITION|EXPLANATION|EXAMPLES|FLOW_DIAGRAM)\]/g;
    const matches = Array.from(text.matchAll(markerRegex));

    if (!matches.length) {
      sections.EXPLANATION = text.trim();
      return sections;
    }

    const appendUnique = (key: string, value: string) => {
      const cleaned = value
        .replace(/\[(TECHNICAL_DEFINITION|EXPLANATION|EXAMPLES|FLOW_DIAGRAM)\]/g, '')
        .trim();
      if (!cleaned) return;
      if (sections[key].includes(cleaned)) return;
      sections[key] = sections[key] ? `${sections[key]}\n\n${cleaned}` : cleaned;
    };

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const key = current[1];
      const start = (current.index ?? 0) + current[0].length;
      const end = i < matches.length - 1 ? (matches[i + 1].index ?? text.length) : text.length;
      const block = text.slice(start, end);
      appendUnique(key, block);
    }

    return sections;
  };

  const renderContent = (text: string) => {
    // Split by code blocks first
    const normalizedText = text.replace(/\[(TECHNICAL_DEFINITION|EXPLANATION|EXAMPLES|FLOW_DIAGRAM)\]/g, '').trim();
    const sections = normalizedText.split(/(```[\s\S]*?```)/g);
    
    return sections.map((section, sectionIdx) => {
      if (section.startsWith('```')) {
        const content = section.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        const lang = section.match(/```(\w+)/)?.[1] || 'code';
        
        return (
          <div key={sectionIdx} className="my-3 relative group">
            <div className="absolute -top-2 left-3 px-1.5 py-0.5 bg-neutral-100 text-[8px] font-black uppercase tracking-[0.2em] text-neutral-500 z-10 border border-neutral-200">
              {lang}
            </div>
            <pre className="bg-neutral-50 border border-neutral-100 p-4 pt-6 rounded-sm overflow-x-auto font-mono text-xs sm:text-sm leading-relaxed text-neutral-800 shadow-sm">
              <code>{content}</code>
            </pre>
          </div>
        );
      }
      
      // Split remaining text into paragraphs and handle basics like headers, lists, and bold
      const paragraphs = section.split('\n\n');
      
      return paragraphs.map((para, paraIdx) => {
        if (!para.trim()) return null;

        // Check for Headers (# Theory)
        if (para.startsWith('#')) {
          const level = (para.match(/^#+/) || ['#'])[0].length;
          const headerText = para.replace(/^#+\s*/, '');
          // FIX: Use 'any' type to avoid environment-specific "Cannot find namespace 'JSX'" errors
          // and ensure the dynamic tag is recognized as a valid JSX element.
          const Tag = `h${Math.min(level + 1, 6)}` as any;
          return (
            <Tag key={`${sectionIdx}-${paraIdx}`} className="font-black text-black uppercase tracking-tight mt-6 mb-3 first:mt-0">
              {headerText}
            </Tag>
          );
        }

        // Check for List items
        if (para.includes('\n* ') || para.includes('\n- ') || para.startsWith('* ') || para.startsWith('- ')) {
          const lines = para.split('\n');
          return (
            <ul key={`${sectionIdx}-${paraIdx}`} className="space-y-1.5 mb-3 ml-5 list-disc text-neutral-800 text-base sm:text-lg leading-relaxed">
              {lines.map((line, lineIdx) => {
                const cleanLine = line.replace(/^[\*\-]\s*/, '');
                return <li key={lineIdx}>{renderSpans(cleanLine)}</li>;
              })}
            </ul>
          );
        }

        return (
          <p key={`${sectionIdx}-${paraIdx}`} className="mb-3 last:mb-0 text-neutral-900 text-base sm:text-xl font-medium leading-relaxed tracking-tight antialiased">
            {renderSpans(para)}
          </p>
        );
      });
    });
  };

  const sections = extractSections(item.text);
  const cleanTechnicalDefinition = dedupeTechnicalDefinition(sections.TECHNICAL_DEFINITION || 'N/A');

  const renderSpans = (text: string) => {
    return text.split(/(\*\*.*?\*\*)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <span key={i}>{part.slice(2, -2)}</span>;
      }
      return part;
    });
  };

  return (
    <div className="max-w-7xl animate-in fade-in slide-in-from-bottom-6 duration-700">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4">
        <section className="md:col-span-3 border border-neutral-100 rounded-sm bg-white p-3 sm:p-4">
          <div className="mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-neutral-400">Technical Definition</span>
          </div>
          <div className="whitespace-pre-wrap">
            {renderContent(cleanTechnicalDefinition || 'N/A')}
          </div>

          <div className="mt-3 mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-neutral-400">Explanation</span>
          </div>
          <div className="whitespace-pre-wrap">
            {renderContent(sections.EXPLANATION || '')}
            {!item.isComplete && (
              <span className="inline-block w-1 h-5 ml-2 bg-black animate-[blink_1s_infinite_step-end] align-middle" />
            )}
          </div>
        </section>

        <section className="md:col-span-2 border border-neutral-100 rounded-sm bg-neutral-50/40 p-3 sm:p-4">
          <div className="mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-neutral-400">Examples</span>
          </div>
          <div className="whitespace-pre-wrap">
            {renderContent(sections.EXAMPLES || 'N/A')}
          </div>

          <div className="mt-3 mb-2">
            <span className="text-[8px] font-black uppercase tracking-[0.25em] text-neutral-400">Flow Diagram</span>
          </div>
          <div className="whitespace-pre-wrap">
            {renderContent(sections.FLOW_DIAGRAM || 'N/A')}
          </div>
        </section>
      </div>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        h2 { font-size: 1.2rem; letter-spacing: -0.01em; border-bottom: 1px solid #f5f5f5; padding-bottom: 0.2rem; margin-bottom: 0.45rem; }
        h3 { font-size: 1.05rem; letter-spacing: -0.01em; margin-bottom: 0.4rem; }
        @media (min-width: 640px) {
          h2 { font-size: 1.5rem; }
          h3 { font-size: 1.2rem; }
        }
      `}</style>
    </div>
  );
};

export default ResponseDisplay;
