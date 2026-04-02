'use client';

import { useState } from 'react';

import type { ToolLikePart } from '../../../lib/types/types';

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

  if (part.state === 'output-error') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">工具执行失败</div>
            <div className="text-xs opacity-80">{title}</div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="text-xs font-medium underline-offset-2 hover:underline"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>
        {expanded ? (
          <div className="whitespace-pre-wrap break-words">{part.errorText ?? '未知错误'}</div>
        ) : (
          <div className="truncate">{part.errorText ?? '未知错误'}</div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={part.state === 'output-available' ? '' : 'animate-spin'}>⚙️</span>
          <span className="font-medium">{title}</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      <div className="mb-2 text-xs text-slate-500 dark:text-zinc-400">
        {part.state === 'output-available' ? '工具调用完成' : '工具调用中'}
      </div>

      {expanded ? (
        <>
          {prettyInput && (
            <pre className="mb-2 overflow-x-auto rounded-xl bg-white/80 p-3 text-xs whitespace-pre-wrap break-words dark:bg-zinc-800">
              {prettyInput}
            </pre>
          )}
          {part.state === 'output-available' && prettyOutput && (
            <pre className="overflow-x-auto rounded-xl bg-white/80 p-3 text-xs whitespace-pre-wrap break-words dark:bg-zinc-800">
              {prettyOutput}
            </pre>
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
