'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UIMessage } from '@ai-sdk/react';

// ── 类型与命令列表 ─────────────────────────────────────────────────────────────

export type SlashCommand = {
  name: string;
  args?: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'clear',   description: '清空当前对话' },
  { name: 'skills',  description: '列出所有可用技能' },
  { name: 'models',  args: '[provider]', description: '列出所有 provider，或指定 provider 下的模型' },
  { name: 'model',   args: '<provider> <model_id>', description: '切换模型，例如 /model grok grok-3' },
  { name: 'usage',   description: '查看 token 用量统计' },
  { name: 'balance', description: '查询当前 provider 账户余额' },
];

// ── useCommands hook ──────────────────────────────────────────────────────────

interface UseCommandsDeps {
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
}

export function useCommands({ setMessages }: UseCommandsDeps) {
  const insertSystemMessage = useCallback((text: string) => {
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
  }, [setMessages]);

  /** 返回 true 表示输入已被命令拦截，不需要发给 AI */
  const handleCommand = useCallback(async (raw: string): Promise<boolean> => {
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

      case 'balance': {
        const res = await fetch('/api/balance').then(async r => {
          if (!r.ok) { const e = await r.json().catch(() => null); return { error: e?.detail || `HTTP ${r.status}` }; }
          return r.json();
        }).catch(() => ({ error: '请求失败' }));
        if (res.error) { insertSystemMessage(`**余额查询失败**：${res.error}`); return true; }
        const infos = res.data?.balance_infos;
        if (!infos?.length) { insertSystemMessage('未获取到余额信息。'); return true; }
        const b = infos[0];
        insertSystemMessage(
          `**账户余额（${res.provider}）**\n\n` +
          `| 项目 | 金额（${b.currency}） |\n|------|------|\n` +
          `| 总余额 | ${b.total_balance} |\n` +
          `| 赠送余额 | ${b.granted_balance} |\n` +
          `| 充值余额 | ${b.topped_up_balance} |\n`
        );
        return true;
      }

      default:
        insertSystemMessage(`未知命令 \`/${name}\`。输入 \`/\` 查看可用命令。`);
        return true;
    }
  }, [setMessages, insertSystemMessage]);

  return { handleCommand };
}

// ── CommandSuggestions 组件 ───────────────────────────────────────────────────

interface CommandSuggestionsProps {
  setInput: Dispatch<SetStateAction<string>>;
  suggestions: SlashCommand[];
  showSuggestions: boolean;
  selectedSuggestion: number;
  setSelectedSuggestion: Dispatch<SetStateAction<number>>;
}

/**
 * 命令补全状态 hook。
 * 管理 suggestions 列表和选中项，供 CommandSuggestions 组件和 onKeyDown 使用。
 */
export function useCommandSuggestions(input: string) {
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);

  const suggestions = input.startsWith('/')
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(input.slice(1).split(' ')[0].toLowerCase()))
    : [];
  const showSuggestions = suggestions.length > 0 && !input.slice(1).includes(' ');

  useEffect(() => { setSelectedSuggestion(-1); }, [input]);

  return { suggestions, showSuggestions, selectedSuggestion, setSelectedSuggestion };
}

export function CommandSuggestions({
  setInput,
  suggestions,
  showSuggestions,
  selectedSuggestion,
  setSelectedSuggestion,
}: CommandSuggestionsProps) {
  if (!showSuggestions) return null;

  return (
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
  );
}
