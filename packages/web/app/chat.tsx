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
import remarkGfm from 'remark-gfm';

import { ProgressTrail } from './components/chat/ProgressTrail';
import { ToolCard } from './components/chat/ToolCard';
import { SessionSidebar } from './components/SessionSidebar';
import { getCurrentSessionMessages, getProgressStages } from './components/chat/progress';
import type { ToolLikePart } from '../lib/types/types';

// ── 斜杠命令定义 ──────────────────────────────────────────────────────────────

type SlashCommand = {
  name: string;
  args?: string;        // 参数提示，如 "[provider]"
  description: string;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear',  description: '清空当前对话' },
  { name: 'skills', description: '列出所有可用技能' },
  { name: 'models', args: '[provider]', description: '列出所有 provider，或指定 provider 下的模型' },
  { name: 'model',  args: '<provider> <model_id>', description: '切换模型，例如 /model grok grok-3' },
  { name: 'usage',  description: '查看 token 用量统计' },
];

/**
 * 生成新的会话 ID。
 *
 * 格式：sess-{12位十六进制}，例如 sess-a1b2c3d4e5f6
 * 优先使用 crypto.randomUUID()，但该 API 仅在 HTTPS 或 localhost 下可用。
 * HTTP 环境（如内网服务器）会报错，降级为 Math.random() 方案。
 */
function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `sess-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  // 降级方案：用 Math.random 生成12位十六进制
  return `sess-${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
}

export default function Chat() {
  const [input, setInput] = useState('');
  // 历史输入记录，用于上下键切换
  const [inputHistory, setInputHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('chat-input-history') ?? '[]');
    } catch { return []; }
  });
  const [historyIndex, setHistoryIndex] = useState(-1);

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // 命令补全：输入 / 开头时显示候选列表
  const suggestions = input.startsWith('/')
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(input.slice(1).split(' ')[0].toLowerCase()))
    : [];
  const showSuggestions = suggestions.length > 0 && !input.slice(1).includes(' ');
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  // 输入变化时重置选中项
  useEffect(() => { setSelectedSuggestion(-1); }, [input]);

  // input 变化时同步 textarea 高度（含历史切换场景）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    // AI SDK v6 新版本将 body/headers 等 HTTP 配置移到了 transport 层
    // 需要通过 DefaultChatTransport 传入，而不是直接在 useChat 选项里写 body
    // useMemo 确保 currentSessionId 变化时 transport 实例跟着更新
    transport: useMemo(
      () => new DefaultChatTransport({ body: { session_id: currentSessionId } }),
      [currentSessionId],
    ),
    onError: (err) => {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'error' as any,
          parts: [{ type: 'text' as const, text: err.message }],
          createdAt: new Date(),
        },
      ]);
    },
  });

  const prevStatus = useRef(status);
  useEffect(() => {
    const wasLoading = prevStatus.current === 'streaming' || prevStatus.current === 'submitted';
    const isNowDone = status === 'ready' || status === 'error';
    prevStatus.current = status;
    if (!wasLoading || !isNowDone || messages.length === 0) return;

    // 出错时 session 里只保存正常的 messages，不混入错误提示
    // 错误展示由 useChat 的 error 状态在 UI 层处理，不污染发给模型的对话历史
    const msgsToSave = messages;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  }

  // ── 命令系统 ────────────────────────────────────────────────────────────────

  /**
   * 把一段文本作为"系统消息"插入对话列表，不发给模型。
   * 用于展示命令执行结果。
   */
  function insertSystemMessage(text: string) {
    setMessages(prev => [
      ...prev,
      {
        id: `cmd-${Date.now()}`,
        role: 'assistant' as const,
        parts: [
          { type: 'step-start' as const },
          { type: 'text' as const, text },
        ],
        createdAt: new Date(),
      },
    ]);
  }

  async function handleCommand(raw: string): Promise<boolean> {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/')) return false;

    // 先把命令本身作为用户消息插入聊天记录
    setMessages(prev => [
      ...prev,
      {
        id: `cmd-user-${Date.now()}`,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: trimmed }],
        createdAt: new Date(),
      },
    ]);

    const parts = trimmed.slice(1).trim().split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (name) {
      case 'clear':
        setMessages([]);
        return true;

      case 'skills': {
        const res = await fetch('/api/skills').then(r => r.json()).catch(() => ({ data: [] }));
        const skills: Array<{ frontmatter: { name: string; description: string } }> = res.data ?? [];
        if (skills.length === 0) {
          insertSystemMessage('暂无可用技能。');
        } else {
          const lines = skills.map(s => `- **${s.frontmatter.name}**：${s.frontmatter.description}`).join('\n');
          insertSystemMessage(`**可用技能（${skills.length} 个）**\n\n${lines}`);
        }
        return true;
      }

      case 'models': {
        const provider = args[0];
        const url = provider ? `/api/models?provider=${encodeURIComponent(provider)}` : '/api/models';
        const res = await fetch(url).then(r => r.json()).catch(() => null);
        if (!res) { insertSystemMessage('获取模型列表失败。'); return true; }

        if (provider) {
          if (res.error) {
            insertSystemMessage(`获取 **${provider}** 模型列表失败：${res.error}`);
          } else {
            const list = (res.data as string[]).map(m => `- \`${m}\``).join('\n');
            insertSystemMessage(`**${provider}** 可用模型：\n\n${list || '（无）'}`);
          }
        } else {
          const providers: Array<{ name: string; base_url: string; active: boolean }> = res.data ?? [];
          const lines = providers.map(p => `- ${p.active ? '**' : ''}${p.name}${p.active ? '** ✓（当前）' : ''}：\`${p.base_url}\``).join('\n');
          insertSystemMessage(`**已配置的 Provider**\n\n${lines}\n\n使用 \`/models <provider>\` 查看该 provider 下的模型列表。`);
        }
        return true;
      }

      case 'model': {
        if (args.length < 2) {
          insertSystemMessage('用法：`/model <provider> <model_id>`\n\n例如：`/model grok grok-3`');
          return true;
        }
        const [provider, modelId] = args;
        const res = await fetch('/api/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, model: modelId }),
        }).then(r => r.json()).catch(() => null);

        if (!res) {
          insertSystemMessage('切换模型失败，请检查后端日志。');
        } else if (res.detail) {
          insertSystemMessage(`切换失败：${res.detail}`);
        } else {
          insertSystemMessage(`已切换到 **${res.provider}** / \`${res.model}\``);
        }
        return true;
      }

      case 'usage': {
        const res = await fetch('/api/usage').then(r => r.json()).catch(() => null);
        if (!res) { insertSystemMessage('获取用量数据失败。'); return true; }
        insertSystemMessage(
          `**Token 用量统计**\n\n` +
          `| 指标 | 数值 |\n|------|------|\n` +
          `| 当前 Provider | ${res.current_provider} |\n` +
          `| 当前模型 | \`${res.current_model}\` |\n` +
          `| 请求次数 | ${res.total_requests} |\n` +
          `| Prompt tokens | ${res.prompt_tokens} |\n` +
          `| Completion tokens | ${res.completion_tokens} |\n` +
          `| 合计 tokens | **${res.total_tokens}** |\n\n` +
          `_注：统计从服务器上次启动开始累计，重启后清零。_`
        );
        return true;
      }

      default:
        insertSystemMessage(`未知命令 \`/${name}\`。输入 \`/\` 查看可用命令。`);
        return true;
    }
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
      {/* 移动端遮罩层 */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* 侧边栏：移动端抽屉式，桌面端可折叠 */}
      <div
        className={`
          fixed inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out
          md:relative md:z-auto md:translate-x-0 md:transition-all
          border-r border-gray-200 dark:border-zinc-800 overflow-hidden
          ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${isSidebarCollapsed ? 'md:w-0' : 'md:w-72'}
          w-72
        `}
      >
        <SessionSidebar
          currentSessionId={currentSessionId}
          onSelect={(id) => { loadSession(id); setIsMobileSidebarOpen(false); }}
          onNew={() => { handleNew(); setIsMobileSidebarOpen(false); }}
          onDelete={handleDelete}
          refreshTrigger={sidebarRefresh}
        />
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            {/* 移动端：汉堡菜单 */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors md:hidden"
              title="打开侧边栏"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {/* 桌面端：折叠按钮 */}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
              title={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isSidebarCollapsed ? 'rotate-180' : ''}`}>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-base font-semibold text-gray-800 dark:text-zinc-100 md:text-lg">🤖 AI 助手</h1>
          </div>
          <button
            onClick={() => { setMessages([]); }}
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
                  <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
                    <div className="mb-1 font-medium">请求失败</div>
                    <div className="max-h-40 overflow-y-auto break-words whitespace-pre-wrap">{errText}</div>
                  </div>
                </div>
              );
            }

            if (isUser) {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-br-sm bg-indigo-500 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white shadow-sm">
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

                  <div className="max-w-[85%] md:max-w-[75%] space-y-2">
                    {showProgressInReply && firstAssistantInCurrentSession?.id === message.id && stepIndex === 0 && (
                      <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
                        <ProgressTrail stages={progressStages} isLoading={isLoading} />
                      </div>
                    )}

                    {hasTextCard && (
                      <div className="prose prose-sm max-w-none overflow-x-auto rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 leading-relaxed text-gray-800 shadow-sm dark:prose-invert dark:bg-zinc-800 dark:text-zinc-100">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
                      </div>
                    )}

                    {toolParts.map(part => <ToolCard key={part.toolCallId} part={part as ToolLikePart} />)}
                  </div>
                </div>
              );
            });
          })}

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

        <div className="relative border-t border-gray-200 bg-white px-3 py-3 pb-safe dark:border-zinc-800 dark:bg-zinc-900 md:px-4 md:py-4">
          {/* 命令补全浮层：绝对定位，浮在输入框上方，不占用布局空间 */}
          {showSuggestions && (
            <div className="absolute bottom-full left-3 right-3 z-50 mb-1 mx-auto max-w-3xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800 md:left-4 md:right-4">
              {suggestions.map((cmd, idx) => (
                <button
                  key={cmd.name}
                  type="button"
                  className={`flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm transition-colors ${
                    idx === selectedSuggestion
                      ? 'bg-indigo-50 dark:bg-indigo-900/40'
                      : 'hover:bg-gray-50 dark:hover:bg-zinc-700'
                  }`}
                  onMouseDown={e => {
                    e.preventDefault();
                    setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`);
                    setSelectedSuggestion(-1);
                  }}
                >
                  <span className="font-mono font-medium text-indigo-600 dark:text-indigo-400">/{cmd.name}</span>
                  {cmd.args && <span className="text-xs text-gray-400">{cmd.args}</span>}
                  <span className="text-gray-500 dark:text-zinc-400">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}
          <form
            className="mx-auto flex max-w-3xl items-center gap-2"
            onSubmit={async event => {
              event.preventDefault();
              if (isLoading) { stop(); return; }
              if (!input.trim()) return;
              // 如果有选中的补全项，先填充
              if (showSuggestions && selectedSuggestion >= 0) {
                const cmd = suggestions[selectedSuggestion];
                setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`);
                setSelectedSuggestion(-1);
                return;
              }
              const text = input;
              setInput('');
              setHistoryIndex(-1);
              if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
              if (text.trim()) setInputHistory(prev => {
                const next = [text, ...prev.filter(h => h !== text).slice(0, 48)];
                localStorage.setItem('chat-input-history', JSON.stringify(next));
                return next;
              });
              if (await handleCommand(text)) return;
              sendMessage({ text });
            }}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 resize-none rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              style={{ maxHeight: '8rem', overflowY: 'auto' }}
              value={input}
              placeholder="输入消息或 / 使用命令..."
              onChange={event => setInput(event.currentTarget.value)}
              onKeyDown={async event => {
                // IME 组合输入期间忽略所有快捷键（避免中文输入法确认时误触发）
                if (event.nativeEvent.isComposing) return;

                // 命令补全导航
                if (showSuggestions) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSelectedSuggestion(i => Math.min(i + 1, suggestions.length - 1));
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSelectedSuggestion(i => Math.max(i - 1, -1));
                    return;
                  }
                  if (event.key === 'Tab' || (event.key === 'Enter' && selectedSuggestion >= 0)) {
                    event.preventDefault();
                    const cmd = suggestions[selectedSuggestion >= 0 ? selectedSuggestion : 0];
                    setInput(`/${cmd.name}${cmd.args ? ' ' : ''}`);
                    setSelectedSuggestion(-1);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setSelectedSuggestion(-1);
                    setInput('');
                    return;
                  }
                }

                // Shift+Enter：换行
                if (event.key === 'Enter' && event.shiftKey) {
                  return; // 让默认行为插入换行
                }

                // Enter（无 Shift）：提交
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (isLoading) { stop(); return; }
                  if (!input.trim()) return;
                  const text = input;
                  setInput('');
                  setHistoryIndex(-1);
                  if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
                  if (text.trim()) setInputHistory(prev => {
                const next = [text, ...prev.filter(h => h !== text).slice(0, 48)];
                localStorage.setItem('chat-input-history', JSON.stringify(next));
                return next;
              });
                  if (await handleCommand(text)) return;
                  sendMessage({ text });
                  return;
                }

                // 上下键切换历史：判断光标是否在首行/末行
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  const el = textareaRef.current;
                  if (!el) return;
                  const cursor = el.selectionStart;
                  const firstNewline = input.indexOf('\n');
                  const lastNewline = input.lastIndexOf('\n');
                  const onFirstLine = firstNewline === -1 || cursor <= firstNewline;
                  const onLastLine = lastNewline === -1 || cursor > lastNewline;

                  if (event.key === 'ArrowUp' && onFirstLine) {
                    event.preventDefault();
                    const next = Math.min(historyIndex + 1, inputHistory.length - 1);
                    if (next !== historyIndex) {
                      setHistoryIndex(next);
                      setInput(inputHistory[next] ?? '');
                    }
                  } else if (event.key === 'ArrowDown' && onLastLine && historyIndex >= 0) {
                    event.preventDefault();
                    const next = historyIndex - 1;
                    setHistoryIndex(next);
                    setInput(next < 0 ? '' : inputHistory[next]);
                  }
                }
              }}
            />
            <button
              type="submit"
              disabled={!isLoading && !input.trim()}
              className={isLoading
                ? "rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
                : "rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:bg-indigo-300 dark:disabled:bg-indigo-900"
              }
            >
              {isLoading ? '暂停' : '发送'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
