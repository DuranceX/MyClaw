'use client';

import { useState } from 'react';

import type { ToolLikePart } from '../../../lib/types/types';

function StatusBadge({ state }: { state: string }) {
  if (state === 'output-available') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        成功
      </span>
    );
  }
  if (state === 'output-error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      运行中
    </span>
  );
}

export function ToolCard({ part }: { part: ToolLikePart }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = part.type.slice(5);
  const titleMap: Record<string, string> = {
    read_file: '读取文件',
    exec_command: '执行命令',
    get_weather: '查询天气',
    web_search: '联网搜索',
  };

  const title = titleMap[toolName] ?? `调用工具：${toolName}`;
  const prettyInput = part.input ? JSON.stringify(part.input, null, 2) : '';
  const prettyOutput =
    typeof part.output === 'string'
      ? part.output
      : part.output
        ? JSON.stringify(part.output, null, 2)
        : '';
  const summary = [prettyInput, part.state === 'output-available' ? prettyOutput : part.errorText ?? '']
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isError = part.state === 'output-error';
  const cardCls = isError
    ? 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100'
    : 'rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

  return (
    <div className={cardCls}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={part.state === 'output-available' || isError ? '' : 'animate-spin'}>⚙️</span>
          <span className="font-medium">{title}</span>
          <StatusBadge state={part.state} />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded ? (
        <>
          {prettyInput && (
            <pre className="mb-2 max-h-60 overflow-auto rounded-xl bg-white/80 p-3 text-xs whitespace-pre-wrap break-words dark:bg-zinc-800">
              {prettyInput}
            </pre>
          )}
          {part.state === 'output-available' && prettyOutput && (
            <pre className="max-h-80 overflow-auto rounded-xl bg-white/80 p-3 text-xs whitespace-pre-wrap break-words dark:bg-zinc-800">
              {prettyOutput}
            </pre>
          )}
          {isError && (
            <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
              {part.errorText ?? '未知错误'}
            </div>
          )}
        </>
      ) : (
        <div className="truncate text-xs text-slate-600 dark:text-zinc-300">
          {summary || '等待工具返回结果...'}
        </div>
      )}
    </div>
  );
}
