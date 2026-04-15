/**
 * chat.tsx — 主聊天页面
 * =======================
 *
 * ## 会话管理设计
 *
 * 本文件在原有聊天功能基础上，新增了多会话持久化支持：
 *
 * ### 状态
 * - currentSessionId: 当前激活的会话 ID（格式 sess-xxxxxxxx）
 * - sidebarRefresh: 计数器，递增时触发侧边栏重新拉取列表
 *
 * ### 数据流
 * ```
 * 用户发送消息
 *   → useChat POST /api/chat（body 含 session_id）
 *   → 流式响应结束（status → ready / error）
 *   → 前端 PUT /api/sessions/{id}（携带完整 messages）
 *   → 后端写入 .chat-sessions/{id}.jsonl
 *   → sidebarRefresh++ → SessionSidebar 重新拉取列表
 * ```
 *
 * ### 为什么由前端主动保存？
 * 后端 stream_chat 只有请求时的 messages（不含本轮 AI 回复）。
 * AI 回复通过 SSE 流发给前端，后端没有完整的最终消息列表。
 * 前端在流结束后主动 PUT 是最简单的方案。
 */

// app/chat.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';

import ReactMarkdown from 'react-markdown';

import { ProgressTrail } from './components/chat/ProgressTrail';
import { ToolCard } from './components/chat/ToolCard';
import { SessionSidebar } from './components/SessionSidebar';
import { getCurrentSessionMessages, getProgressStages } from './components/chat/progress';
import type { ToolLikePart } from '../lib/types/types';

/**
 * 生成新的会话 ID。
 *
 * 格式：sess-{12位十六进制}，例如 sess-a1b2c3d4e5f6
 * 使用 crypto.randomUUID() 生成，截取12位保持简短。
 * 与后端 new_session_id() 函数生成的格式完全一致。
 */
function newSessionId() {
  return `sess-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export default function Chat() {
  const [input, setInput] = useState('');
  const [persistedError, setPersistedError] = useState<Error | null>(null);

  /**
   * 当前激活的会话 ID。
   * 初始值在组件挂载时生成（lazy initializer），
   * 页面加载后如果有历史会话，会被 loadSession 替换为最近的会话 ID。
   */
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => newSessionId());

  /**
   * 侧边栏刷新触发器。
   * 每次需要刷新侧边栏时执行 setSidebarRefresh(n => n + 1)。
   * SessionSidebar 监听这个值的变化，变化时重新拉取会话列表。
   */
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  const { messages, sendMessage, setMessages, status, error } = useChat({
    // AI SDK v6 新版本将 body/headers 等 HTTP 配置移到了 transport 层
    // 需要通过 DefaultChatTransport 传入，而不是直接在 useChat 选项里写 body
    // useMemo 确保 currentSessionId 变化时 transport 实例跟着更新
    transport: useMemo(
      () => new DefaultChatTransport({ body: { session_id: currentSessionId } }),
      [currentSessionId],
    ),
  });

  useEffect(() => {
    if (error) setPersistedError(error);
  }, [error]);

  /**
   * 流结束后自动保存会话（正常结束 or 出错都保存）。
   *
   * ## 检测"流结束"的方式
   *
   * useChat 的 status 有四个值：idle → submitted → streaming → ready/error
   * 我们需要检测从 streaming/submitted 变为 ready/error 的瞬间。
   *
   * 用 prevStatus ref 记录上一次的 status，在 effect 里比较：
   * - wasLoading: 上一次是 streaming 或 submitted（正在处理中）
   * - isNowDone: 现在是 ready 或 error（处理完成）
   * 两者都为 true 时，说明刚刚完成了一次请求。
   *
   * 为什么不直接用 status === 'ready'？
   * 因为 status 初始值也是 'ready'（idle 状态），
   * 如果直接判断 ready 会在页面加载时误触发保存。
   *
   * ## 错误时的特殊处理
   *
   * useChat 的 error 在下次发送消息时会被重置，
   * 所以出错时需要立即把错误信息追加到消息列表里保存。
   * 追加的消息使用 role: "error"（AI SDK 标准格式的扩展），
   * 前端加载历史时会渲染为红色错误卡片。
   */
  const prevStatus = useRef(status);
  useEffect(() => {
    const wasLoading = prevStatus.current === 'streaming' || prevStatus.current === 'submitted';
    const isNowDone = status === 'ready' || status === 'error';
    prevStatus.current = status;
    if (!wasLoading || !isNowDone || messages.length === 0) return;

    // 出错时把错误信息作为一条特殊消息追加，这样历史记录里能看到错误
    const msgsToSave = status === 'error' && error
      ? [...messages, { id: `err-${Date.now()}`, role: 'error' as const, parts: [{ type: 'text', text: error.message }] }]
      : messages;

    fetch(`/api/sessions/${currentSessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgsToSave }),
    }).then(() => setSidebarRefresh(n => n + 1)).catch(() => {});
  }, [status]);

  /**
   * 页面加载时自动恢复最近的会话。
   *
   * 拉取会话列表（按 updated_at 降序），自动选中第一条（最近更新的）。
   * 这样用户刷新页面后能直接看到上次的对话，不需要手动点击。
   *
   * 依赖数组为空（[]），只在组件挂载时执行一次。
   */
  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then((sessions: Array<{ id: string }>) => {
        if (sessions.length > 0) {
          loadSession(sessions[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'streaming' || status === 'submitted';
  const currentSessionMessages = getCurrentSessionMessages(messages);
  const progressStages = getProgressStages(currentSessionMessages);
  const firstAssistantInCurrentSession = currentSessionMessages.find(message => message.role === 'assistant');
  const showProgressInReply = Boolean(firstAssistantInCurrentSession);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * 加载指定会话的历史消息。
   *
   * 步骤：
   * 1. 更新 currentSessionId（侧边栏高亮切换）
   * 2. 清空错误状态
   * 3. 从后端拉取消息列表
   * 4. setMessages(data.messages) 直接恢复 useChat 状态
   *
   * 消息格式与 AI SDK UIMessage 完全一致，所以 setMessages 可以无缝恢复，
   * 不需要任何格式转换。
   */
  function loadSession(id: string) {
    setCurrentSessionId(id);
    setPersistedError(null);
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then((data: { messages: typeof messages }) => setMessages(data.messages))
      .catch(() => {});
  }

  /**
   * 新建空白会话。
   *
   * 生成新的 session ID，清空消息列表和错误状态。
   * 新会话在用户发送第一条消息并收到回复后才会被保存到后端。
   */
  function handleNew() {
    setCurrentSessionId(newSessionId());
    setMessages([]);
    setPersistedError(null);
  }

  /**
   * 删除指定会话。
   *
   * 删除后：
   * 1. 触发侧边栏刷新（列表中移除该项）
   * 2. 如果删除的是当前会话，自动新建一个空会话
   *    （避免用户停留在一个已不存在的会话上）
   */
  function handleDelete(id: string) {
    fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      .then(() => {
        setSidebarRefresh(n => n + 1);
        if (id === currentSessionId) handleNew();
      })
      .catch(() => {});
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-zinc-950">
      <SessionSidebar
        currentSessionId={currentSessionId}
        onSelect={loadSession}
        onNew={handleNew}
        onDelete={handleDelete}
        refreshTrigger={sidebarRefresh}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-zinc-100">🤖 AI 助手</h1>
          <button
            onClick={() => { setMessages([]); setPersistedError(null); }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            清屏
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="mt-20 text-center text-sm text-gray-400 dark:text-zinc-600">
              发送消息开始对话
            </div>
          )}

          {messages.map(message => {
            const isUser = message.role === 'user';
            type Part = typeof message.parts[number];
            type TextPart = Extract<Part, { type: 'text' }>;
            type ToolPart = Extract<Part, { type: `tool-${string}` }>;

            // 错误消息（从历史记录加载）
            if ((message.role as string) === 'error') {
              const errText = message.parts.find(p => p.type === 'text')?.text ?? '';
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm text-white">AI</div>
                  <div className="max-w-[75%] rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
                    <div className="mb-1 font-medium">请求失败</div>
                    <div className="break-words whitespace-pre-wrap">{errText}</div>
                  </div>
                </div>
              );
            }

            if (isUser) {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-indigo-500 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white shadow-sm">
                    {message.parts.map((part, index) => part.type === 'text' && <span key={index}>{part.text}</span>)}
                  </div>
                  <div className="ml-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm text-gray-600 dark:bg-zinc-600 dark:text-zinc-200">
                    你
                  </div>
                </div>
              );
            }

            const steps = message.parts.reduce<Part[][]>((acc, part) => {
              if (part.type === 'step-start') {
                acc.push([]);
              } else if (acc.length > 0) {
                acc[acc.length - 1].push(part);
              }
              return acc;
            }, []);

            const nonEmptySteps = steps.filter(step => step.some(part => part.type === 'text' || part.type.startsWith('tool-')));

            return nonEmptySteps.map((stepParts, stepIndex) => {
              const textParts = stepParts.filter((part): part is TextPart => part.type === 'text');
              // 每个工具调用会产生多个 part（tool-input-available、tool-output-available / tool-output-error）。
              // 只取每个 toolCallId 的最终状态 part，避免同一个工具调用渲染多张卡片。
              const allToolParts = stepParts.filter((part): part is ToolPart => part.type.startsWith('tool-'));
              const toolPartsByCallId = new Map<string, ToolPart>();
              for (const part of allToolParts) {
                const id = (part as unknown as { toolCallId?: string }).toolCallId ?? part.type;
                toolPartsByCallId.set(id, part);
              }
              const toolParts = Array.from(toolPartsByCallId.values());
              const hasTextCard = textParts.length > 0;
              const textContent = textParts.map(part => part.text).join('');

              return (
                <div key={`${message.id}-${stepIndex}`} className="flex justify-start">
                  {stepIndex === 0 ? (
                    <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm text-white">
                      AI
                    </div>
                  ) : (
                    <div className="mr-2 w-8 shrink-0" />
                  )}

                  <div className="max-w-[75%] space-y-2">
                    {showProgressInReply && firstAssistantInCurrentSession?.id === message.id && stepIndex === 0 && (
                      <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                        <ProgressTrail stages={progressStages} isLoading={isLoading} />
                      </div>
                    )}

                    {hasTextCard && (
                      <div className="prose prose-sm max-w-none rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 leading-relaxed text-gray-800 shadow-sm dark:prose-invert dark:bg-zinc-800 dark:text-zinc-100">
                        <ReactMarkdown>{textContent}</ReactMarkdown>
                      </div>
                    )}

                    {toolParts.map(part => <ToolCard key={part.toolCallId} part={part as ToolLikePart} />)}
                  </div>
                </div>
              );
            });
          })}

          {persistedError && (
            <div className="flex justify-start">
              <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm text-white">
                AI
              </div>
              <div className="max-w-[75%] rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
                <div className="mb-1 font-medium">请求失败</div>
                <div className="break-words whitespace-pre-wrap">{persistedError.message}</div>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm text-white">
                AI
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm dark:bg-zinc-800">
                <div className="flex h-4 items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-gray-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <form
            className="mx-auto flex max-w-3xl items-center gap-2"
            onSubmit={event => {
              event.preventDefault();
              if (!input.trim() || isLoading) return;
              sendMessage({ text: input });
              setInput('');
            }}
          >
            <input
              className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              value={input}
              placeholder="输入消息，按 Enter 发送..."
              onChange={event => setInput(event.currentTarget.value)}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:bg-indigo-300 dark:disabled:bg-indigo-900"
            >
              发送
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
