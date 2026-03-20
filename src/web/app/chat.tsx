// app/chat.tsx
'use client';

import { useChat } from '@ai-sdk/react'
import { useState, useRef, useEffect } from 'react';

export default function Chat() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, setMessages, status } = useChat()
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'streaming' || status === 'submitted';

  // 新消息到来时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-zinc-950">
      {/* 顶部标题栏 */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <h1 className="text-lg font-semibold text-gray-800 dark:text-zinc-100">🤖 AI 助手</h1>
        <button
          onClick={() => setMessages([])}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
        >
          {/* 垃圾桶图标 */}
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          清屏
        </button>
      </header>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 dark:text-zinc-600 mt-20 text-sm">
            发送消息开始对话
          </div>
        )}

        {messages.map(m => {
          const isUser = m.role === 'user';

          // ── 用户消息：单气泡 ──────────────────────────────────────────────
          if (isUser) {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm bg-indigo-500 text-white rounded-br-sm">
                  {m.parts.map((part, i) => part.type === 'text' && <span key={i}>{part.text}</span>)}
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-zinc-600 flex items-center justify-center text-gray-600 dark:text-zinc-200 text-sm ml-2 mt-1 shrink-0">
                  你
                </div>
              </div>
            );
          }

          // ── AI 消息：按 step-start 拆分成多个气泡 ────────────────────────

          // 每遇到 step-start 就开一个新分组
          type Part = typeof m.parts[number];
          type ToolPart = { type: `tool-${string}`; toolCallId: string; state: string; input: any; output: any };

          const steps = m.parts.reduce<Part[][]>((acc, part) => {
            if (part.type === 'step-start') {
              acc.push([]);
            } else if (acc.length > 0) {
              acc[acc.length - 1].push(part);
            }
            return acc;
          }, []);

          // 过滤掉空 step（流式传输尾部可能产生空 step-start）
          const nonEmptySteps = steps.filter(s =>
            s.some(p => p.type === 'text' ? (p as any).text.trim() : p.type.startsWith('tool-'))
          );

          return nonEmptySteps.map((stepParts, stepIndex) => (
            <div key={`${m.id}-${stepIndex}`} className="flex justify-start">
              {/* 第一个 step 显示头像，后续 step 用等宽占位保持对齐 */}
              {stepIndex === 0
                ? <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm mr-2 mt-1 shrink-0">AI</div>
                : <div className="w-8 mr-2 shrink-0" />
              }

              <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 rounded-bl-sm">
                {stepParts.map((part, i) => {
                  if (part.type === 'text') {
                    return <span key={i}>{part.text}</span>;
                  }
                  if (part.type.startsWith('tool-')) {
                    const p = part as ToolPart;
                    const toolName = p.type.slice(5);

                    if (toolName === 'get_weather') {
                      if (p.state !== 'output-available') {
                        return (
                          <div key={p.toolCallId} className="flex items-center gap-2 p-3 bg-blue-50 text-blue-600 rounded-lg animate-pulse my-2 border border-blue-200">
                            <span className="animate-spin">⏳</span>
                            <span>正在调用气象卫星，查询 <strong>{p.input?.city}</strong> 的天气...</span>
                          </div>
                        );
                      }
                      return (
                        <div key={p.toolCallId} className="p-5 bg-white border border-gray-200 shadow-sm rounded-xl my-2 min-w-50">
                          <div className="text-xs text-gray-500 mb-2 font-bold uppercase tracking-wider">
                            📍 {p.input.city} 天气实况
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-4xl font-black text-gray-800">{p.output.temp}°C</span>
                            <span className="text-2xl ml-4">{p.output.condition}</span>
                          </div>
                        </div>
                      );
                    }

                    if (toolName === 'web_search') {
                      if (p.state !== 'output-available') {
                        return (
                          <div key={p.toolCallId} className="flex items-center gap-2 p-3 bg-green-50 text-green-600 rounded-lg animate-pulse my-2 border border-green-200">
                            <span className="animate-spin">⏳</span>
                            <span>正在搜索互联网，查询 <strong>{p.input?.query}</strong> 的最新信息...</span>
                          </div>
                        );
                      }
                      return <div key={p.toolCallId}>{p.output}</div>;
                    }
                  }
                  return null;
                })}
              </div>
            </div>
          ));
        })}

        {/* 加载动画 */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm mr-2 shrink-0">
              AI
            </div>
            <div className="bg-white dark:bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入栏 */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <form
          className="flex items-center gap-2 max-w-3xl mx-auto"
          onSubmit={e => {
            e.preventDefault();
            if (!input.trim() || isLoading) return;
            sendMessage({ text: input });
            setInput('');
          }}
        >
          <input
            className="flex-1 bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition"
            value={input}
            placeholder="输入消息，按 Enter 发送..."
            onChange={e => setInput(e.currentTarget.value)}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 dark:disabled:bg-indigo-900 text-white text-sm font-medium rounded-xl transition-colors"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
