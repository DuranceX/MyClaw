/**
 * SessionSidebar.tsx — 会话历史列表侧边栏
 * ==========================================
 *
 * ## 职责
 *
 * 展示所有历史会话，支持：
 * - 点击切换会话（加载历史消息）
 * - 顶部"+"按钮新建会话
 * - 悬停时显示删除按钮
 * - 自动刷新列表（通过 refreshTrigger prop）
 *
 * ## 更新
 * 2025.04 - 支持父容器控制宽度，实现可折叠功能
 */

'use client';

import { useEffect, useState } from 'react';

// 会话元数据类型，与后端 SessionMeta 模型对应
type SessionMeta = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  /** 当前激活的会话 ID，用于高亮显示 */
  currentSessionId: string;
  /** 点击会话项时的回调，参数为会话 ID */
  onSelect: (id: string) => void;
  /** 点击"新建会话"按钮时的回调 */
  onNew: () => void;
  /** 点击删除按钮时的回调，参数为会话 ID */
  onDelete: (id: string) => void;
  /**
   * 刷新触发器：数字变化时重新拉取会话列表。
   * 父组件通过递增这个数字来触发刷新，而不是直接调用方法。
   */
  refreshTrigger: number;
};

/**
 * 将 ISO 时间字符串格式化为相对时间描述。
 */
function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function SessionSidebar({ currentSessionId, onSelect, onNew, onDelete, refreshTrigger }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {}); // 静默处理错误
  }, [refreshTrigger]);

  return (
    <aside className="flex h-full w-72 flex-col border-r border-gray-200 bg-white transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-900">
      {/* 顶部标题栏 + 新建按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">历史会话</span>
        <button
          type="button"
          onClick={onNew}
          title="新建会话"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-gray-400 dark:text-zinc-600">暂无历史会话</p>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className={`group flex cursor-pointer items-start gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800 ${
              s.id === currentSessionId ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''
            }`}
            onClick={() => onSelect(s.id)}
          >
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${s.id === currentSessionId ? 'font-medium text-indigo-600 dark:text-indigo-400' : 'text-gray-700 dark:text-zinc-300'}`}>
                {s.title}
              </p>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">{formatTime(s.updated_at)}</p>
            </div>

            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(s.id); }}
              className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-300 hover:text-red-400 group-hover:flex dark:text-zinc-600 dark:hover:text-red-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
