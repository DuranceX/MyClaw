// app/chat.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';

import ReactMarkdown from 'react-markdown';

import { ProgressTrail } from './components/chat/ProgressTrail';
import { ToolCard } from './components/chat/ToolCard';
import { getCurrentSessionMessages, getProgressStages } from './components/chat/progress';
import type { ToolLikePart } from '../lib/types/types';

export default function Chat() {
  const [input, setInput] = useState('');
  const [persistedError, setPersistedError] = useState<Error | null>(null);
  const { messages, sendMessage, setMessages, status, error } = useChat();

  useEffect(() => {
    if (error) setPersistedError(error);
  }, [error]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'streaming' || status === 'submitted';
  const currentSessionMessages = getCurrentSessionMessages(messages);
  const progressStages = getProgressStages(currentSessionMessages);
  const firstAssistantInCurrentSession = currentSessionMessages.find(message => message.role === 'assistant');
  const showProgressInReply = Boolean(firstAssistantInCurrentSession);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-zinc-950">
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
            const toolParts = stepParts.filter((part): part is ToolPart => part.type.startsWith('tool-'));
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
  );
}
