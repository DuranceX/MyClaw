'use client';

import type { ReactNode } from 'react';

import type { ProgressStage, ProgressStageItem } from '../../../lib/types/types';

function renderJsonValue(value: unknown, indent = 0): ReactNode {
  const indentClass = indent > 0 ? 'pl-4' : '';

  if (value === null) {
    return <span className="text-fuchsia-600 dark:text-fuchsia-300">null</span>;
  }

  if (typeof value === 'string') {
    return <span className="text-amber-700 dark:text-amber-300">&quot;{value}&quot;</span>;
  }

  if (typeof value === 'number') {
    return <span className="text-sky-700 dark:text-sky-300">{value}</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span>[]</span>;
    }

    return (
      <span>
        <span>[</span>
        <div className={indentClass}>
          {value.map((item, index) => (
            <div key={index}>
              {renderJsonValue(item, indent + 1)}
              {index < value.length - 1 ? ',' : ''}
            </div>
          ))}
        </div>
        <span>]</span>
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span>{'{}'}</span>;
    }

    return (
      <span>
        <span>{'{'}</span>
        <div className={indentClass}>
          {entries.map(([key, entryValue], index) => (
            <div key={key}>
              <span className="text-emerald-700 dark:text-emerald-300">&quot;{key}&quot;</span>
              <span>: </span>
              {renderJsonValue(entryValue, indent + 1)}
              {index < entries.length - 1 ? ',' : ''}
            </div>
          ))}
        </div>
        <span>{'}'}</span>
      </span>
    );
  }

  return <span className="text-slate-700 dark:text-zinc-200">{String(value)}</span>;
}

export function ProgressTrail({
  stages,
  isLoading,
}: {
  stages: ProgressStageItem[];
  isLoading: boolean;
}) {
  if (stages.length === 0) {
    return null;
  }

  const styleMap: Record<ProgressStage, { label: string; className: string }> = {
    user: {
      label: 'user',
      className: 'bg-indigo-500 text-white',
    },
    assistant: {
      label: 'assistant',
      className: 'bg-sky-500 text-white',
    },
    tool_call: {
      label: 'tool_call',
      className: 'bg-amber-400 text-amber-950',
    },
    tool_result: {
      label: 'tool_result',
      className: 'bg-emerald-400 text-emerald-950',
    },
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {stages.map((item, index) => {
        const stage = item.stage;
        const isLast = index === stages.length - 1;
        return (
          <div key={`${stage}-${index}`} className="group relative flex items-center gap-2">
            <span
              className={[
                'rounded-full px-3 py-1 text-xs font-medium transition-transform',
                styleMap[stage].className,
                isLoading && isLast ? 'animate-pulse' : '',
              ].join(' ')}
            >
              {styleMap[stage].label}
            </span>
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden min-w-80 max-w-[32rem] rounded-2xl border border-slate-200 bg-white/98 p-4 text-xs text-slate-800 shadow-2xl ring-1 ring-slate-100 group-hover:block dark:border-zinc-700 dark:bg-zinc-900/98 dark:text-zinc-100 dark:ring-zinc-800">
              <pre className="whitespace-pre-wrap break-words font-mono">
                {renderJsonValue(item.detail)}
              </pre>
            </div>
            {index < stages.length - 1 && (
              <span className="text-slate-300 dark:text-zinc-600">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
