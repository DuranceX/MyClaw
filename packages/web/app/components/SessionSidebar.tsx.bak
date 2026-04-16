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
 * ## 数据流
 *
 * ```
 * SessionSidebar
 *   ├── 挂载时 / refreshTrigger 变化时 → GET /api/sessions → 更新 sessions 列表
 *   ├── 点击会话项 → onSelect(id) → chat.tsx 的 loadSession()
 *   ├── 点击"+"按钮 → onNew() → chat.tsx 的 handleNew()
 *   └── 点击删除按钮 → onDelete(id) → chat.tsx 的 handleDelete()
 * ```
 *
 * ## refreshTrigger 设计
 *
 * 父组件（chat.tsx）维护一个 sidebarRefresh 计数器，
 * 每次需要刷新侧边栏时执行 setSidebarRefresh(n => n + 1)。
 * 这比直接暴露 refresh() 方法更符合 React 的数据流方向（props down）。
 *
 * 触发刷新的时机：
 * 1. 会话保存成功后（新会话出现在列表中，或标题更新）
 * 2. 会话删除后（列表中移除对应项）
 *
 * ## 当前会话高亮
 *
 * 通过 currentSessionId prop 与列表中每个 session.id 比较，
 * 匹配的项显示蓝色背景和加粗标题。
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
   * 这是 React 中常见的"外部触发 effect"模式。
   */
  refreshTrigger: number;
};

/**
 * 将 ISO 时间字符串格式化为相对时间描述。
 *
 * 规则：
 * - 今天：显示具体时间（如 "14:30"）
 * - 昨天：显示 "昨天"
 * - 7天内：显示 "N天前"
 * - 更早：显示日期（如 "1月1日"）
 *
 * 为什么不用 date-fns 或 dayjs？
 * 这个函数逻辑简单，引入第三方库反而增加了依赖复杂度。
 * 对于这种轻量需求，原生 Date API 足够了。
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

  // 挂载时和 refreshTrigger 变化时重新拉取会话列表
  // 依赖数组只有 refreshTrigger，不包含 setSessions（稳定引用，不需要）
  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {}); // 静默处理错误，列表保持上次状态
  }, [refreshTrigger]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* 顶部标题栏 + 新建按钮 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <span className="text-sm font-medium text-gray-700 dark:text-zinc-300">历史会话</span>
        <button
          type="button"
          onClick={onNew}
          title="新建会话"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          {/* "+" 图标 */}
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
          /*
           * group 类：让子元素可以用 group-hover: 响应父元素的 hover 状态。
           * 删除按钮默认 hidden，hover 时通过 group-hover:flex 显示。
           * 这是 Tailwind 中实现"hover 显示子元素"的标准模式。
           */
          <div
            key={s.id}
            className={`group flex cursor-pointer items-start gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800 ${
              s.id === currentSessionId ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''
            }`}
            onClick={() => onSelect(s.id)}
          >
            <div className="min-w-0 flex-1">
              {/* 标题：当前会话加粗蓝色，其他灰色 */}
              <p className={`truncate text-sm ${s.id === currentSessionId ? 'font-medium text-indigo-600 dark:text-indigo-400' : 'text-gray-700 dark:text-zinc-300'}`}>
                {s.title}
              </p>
              {/* 相对时间：显示 updated_at */}
              <p className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">{formatTime(s.updated_at)}</p>
            </div>

            {/*
             * 删除按钮：默认隐藏（hidden），鼠标悬停在父 div 时显示（group-hover:flex）。
             * e.stopPropagation() 阻止点击删除时触发父 div 的 onClick（切换会话）。
             */}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(s.id); }}
              className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-300 hover:text-red-400 group-hover:flex dark:text-zinc-600 dark:hover:text-red-400"
            >
              {/* "×" 图标 */}
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
