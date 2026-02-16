
import React from 'react';
import { TranscriptionItem } from '../types';

interface ResponseDisplayProps {
  item: TranscriptionItem;
}

const ResponseDisplay: React.FC<ResponseDisplayProps> = ({ item }) => {
  // Enhanced cleaning to keep some markdown if desired, but here we keep it clean
  const cleanedText = item.text
    .replace(/\*\*/g, '')
    .trim();

  return (
    <div className="max-w-4xl">
      <div className="text-2xl sm:text-4xl font-medium leading-[1.3] text-black tracking-tight whitespace-pre-wrap antialiased">
        {cleanedText}
        {!item.isComplete && (
          <span className="inline-block w-1.5 h-8 ml-2 bg-black animate-[blink_1s_infinite_step-end] align-baseline" />
        )}
      </div>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ResponseDisplay;
