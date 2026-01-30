
import React, { useRef, useEffect } from 'react';
import { TranscriptionEntry } from '../types';

interface TranscriptionViewProps {
  entries: TranscriptionEntry[];
}

const TranscriptionView: React.FC<TranscriptionViewProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="flex flex-col h-full bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
      <div className="p-4 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          Neural Activity Log
        </h3>
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-700"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-slate-700"></div>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth scrollbar-hide">
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 text-slate-500">
            <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-xs font-mono uppercase tracking-tighter">Waiting for visual input...</p>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div 
              key={`${entry.timestamp}-${i}`} 
              className={`flex flex-col ${entry.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-500`}
            >
              <span className="text-[9px] uppercase font-bold text-slate-600 mb-1 px-2 tracking-widest">
                {entry.role === 'user' ? 'Human' : entry.role === 'tool' ? 'System_Exec' : 'Gemini_Live'}
              </span>
              <div 
                className={`max-w-[90%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed transition-all ${
                  entry.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-900/30 font-medium' 
                  : entry.role === 'tool'
                  ? 'bg-slate-950 text-emerald-400 rounded-tl-none border border-emerald-900/30 font-mono text-[11px] w-full'
                  : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700 shadow-xl'
                }`}
              >
                {entry.role === 'tool' && <span className="opacity-50 mr-2">$</span>}
                {entry.text}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TranscriptionView;
