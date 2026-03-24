import { createOpenAI } from '@ai-sdk/openai';
import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';

type ToolUIPart = { type: `tool-${string}`; toolCallId: string; state: string; input: unknown; output?: unknown }
import { readFileTool } from './tools/readFile';
import { execCommandTool } from './tools/execCommand';
import { fetchServerJson, SkillEntry } from '@/lib/serverApi';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const maxDuration = 30;

/**
 * 把任意工具输出格式化为日志可读的字符串。
 *
 * @param value 任意可序列化的工具返回值。
 * @returns 用于服务端日志打印的 JSON 字符串。
 */
function formatResult(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * 打印当前请求中的消息和工具调用过程，便于本地调试。
 *
 * @param messages 路由收到的 UIMessage 列表。
 * @returns 无返回值，副作用是输出控制台日志。
 */
function logMessages(messages: UIMessage[]): void {
  const lines: string[] = [`\n${'─'.repeat(60)}`]

  for (const msg of messages) {
    const roleLabel = { user: '👤 User', assistant: '🤖 Assistant', system: '⚙️  System' }[msg.role] ?? msg.role
    lines.push(`\n${roleLabel}`)

    for (const part of msg.parts) {
      switch (part.type) {
        case 'text':
          lines.push(`  ${part.text.trim().replace(/\n/g, '\n  ')}`)
          break
        default: {
          // v6: tool parts 的 type 是 `tool-${toolName}`，属性直接挂在 part 上
          if (part.type.startsWith('tool-')) {
            const p = part as ToolUIPart
            const toolName = p.type.slice(5)
            lines.push(`  🔧 tool_call: ${toolName}(${JSON.stringify(p.input)})`)
            if (p.state === 'output-available') {
              lines.push(`     ↳ result: ${formatResult(p.output)}`)
            }
          } else if (part.type !== 'step-start') {
            lines.push(`  [${part.type}]`)
          }
        }
      }
    }
  }

  lines.push('')
  console.log(lines.join('\n'))
}

/**
 * 从 Python 后端读取当前技能索引。
 *
 * @returns 将被注入 system prompt 的技能列表。
 */
async function getSkills(): Promise<SkillEntry[]> {
  const response = await fetchServerJson<{ data: SkillEntry[] }>('/api/skills')
  return response.data
}

/**
 * 构造 system prompt 中的技能说明部分，让模型知道当前有哪些本地技能可用。
 *
 * @param skills 后端返回的技能元数据列表。
 * @returns 包含技能清单的中文 system prompt 字符串。
 */
function constructSystemPrompt(skills: SkillEntry[]): string {
  const skillDescriptions = skills.map(skill => {
    const { name, description } = skill.frontmatter;
    return `技能名称：${name}\n技能描述：${description}\n技能路径：${skill.path}`;
  }).join('\n\n');

  return `你是一个全能的AI助手，擅长使用各种工具来辅助获取信息，帮助你回答问题。\n\n以下是你可以使用的技能列表, 决定使用哪个技能后使用read_file工具来获取技能的详细内容：\n\n${skillDescriptions}\n\n当用户提问时，你会根据问题内容选择合适的技能来辅助回答。`;
}

/**
 * 处理来自聊天页面的请求，并把 AI SDK 的流式响应返回给浏览器。
 *
 * @param req 包含 `messages` 的 HTTP 请求。
 * @returns 返回给前端的流式响应。
 *
 * 关键逻辑：
 *   当前阶段 LLM 调用仍然留在 Next.js 中，但技能索引和工具执行已经通过
 *   Python 服务边界统一对外提供。
 */
export async function POST(req: Request) {
  const { messages }:{ messages: UIMessage[]} = await req.json();

  logMessages(messages)
  const skills = await getSkills()

  const response = await streamText({
    model: openai.chat('gemini-2.5-pro'),
    system: constructSystemPrompt(skills),
    temperature: 0.2,
    messages: await convertToModelMessages(messages),
    tools: {
      read_file: readFileTool,
      exec_command: execCommandTool,
    },
    stopWhen: stepCountIs(5),
    // 流结束后触发，此时可以拿到完整的文本和 tool calls
    onFinish: () => {
      // console.log('\n=== Final Result ===')
      // console.log(result.response.messages.map(m=>m))
    },
  });

  return response.toUIMessageStreamResponse();
}
