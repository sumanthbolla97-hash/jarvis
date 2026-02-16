
import React from 'react';
import { TranscriptionItem } from '../types';

interface ResponseDisplayProps {
  item: TranscriptionItem;
}

const ResponseDisplay: React.FC<ResponseDisplayProps> = ({ item }) => {
  const renderContent = (text: string) => {
    // Split by code blocks first
    const sections = text.split(/(```[\s\S]*?```)/g);
    
    return sections.map((section, sectionIdx) => {
      if (section.startsWith('```')) {
        const content = section.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        const lang = section.match(/```(\w+)/)?.[1] || 'code';
        
        return (
          <div key={sectionIdx} className="my-10 relative group">
            <div className="absolute -top-3 left-4 px-2 py-0.5 bg-neutral-100 text-[8px] font-black uppercase tracking-[0.2em] text-neutral-500 z-10 border border-neutral-200">
              {lang}
            </div>
            <pre className="bg-neutral-50 border border-neutral-100 p-8 pt-10 rounded-sm overflow-x-auto font-mono text-xs sm:text-sm leading-relaxed text-neutral-800 shadow-sm">
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
            <Tag key={`${sectionIdx}-${paraIdx}`} className="font-black text-black uppercase tracking-tight mt-12 mb-6 first:mt-0">
              {headerText}
            </Tag>
          );
        }

        // Check for List items
        if (para.includes('\n* ') || para.includes('\n- ') || para.startsWith('* ') || para.startsWith('- ')) {
          const lines = para.split('\n');
          return (
            <ul key={`${sectionIdx}-${paraIdx}`} className="space-y-3 mb-8 ml-6 list-disc text-neutral-800 text-lg sm:text-2xl leading-relaxed">
              {lines.map((line, lineIdx) => {
                const cleanLine = line.replace(/^[\*\-]\s*/, '');
                return <li key={lineIdx}>{renderSpans(cleanLine)}</li>;
              })}
            </ul>
          );
        }

        return (
          <p key={`${sectionIdx}-${paraIdx}`} className="mb-8 last:mb-0 text-neutral-900 text-lg sm:text-3xl font-medium leading-[1.4] tracking-tight antialiased">
            {renderSpans(para)}
          </p>
        );
      });
    });
  };

  const renderSpans = (text: string) => {
    return text.split(/(\*\*.*?\*\*)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-black text-black">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className="max-w-5xl animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <div className="whitespace-pre-wrap">
        {renderContent(item.text)}
        {!item.isComplete && (
          <span className="inline-block w-1.5 h-8 ml-3 bg-black animate-[blink_1s_infinite_step-end] align-middle" />
        )}
      </div>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        h2 { font-size: 1.5rem; letter-spacing: -0.02em; border-bottom: 2px solid #f5f5f5; padding-bottom: 0.5rem; }
        h3 { font-size: 1.25rem; letter-spacing: -0.01em; }
        @media (min-width: 640px) {
          h2 { font-size: 2.25rem; }
          h3 { font-size: 1.75rem; }
        }
      `}</style>
    </div>
  );
};

export default ResponseDisplay;
