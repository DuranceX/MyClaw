import { createOpenAI } from '@ai-sdk/openai';
import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';

type ToolUIPart = { type: `tool-${string}`; toolCallId: string; state: string; input: unknown; output?: unknown }
import { readFileTool } from './tools/readFile';
import { execCommandTool } from './tools/execCommand';
import { scanSkills, SkillEntry } from '@/lib/scanner';
import path from 'node:path';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const maxDuration = 30;

// process.cwd() 在 Next.js 中是 src/web/，往上两级才是项目根目录
const PROJECT_ROOT = path.resolve(process.cwd(), '../..');

// 模块加载时扫描一次，结果缓存在 Promise 中，后续请求直接复用
const skillsPromise = scanSkills(PROJECT_ROOT);

function formatResult(value: unknown): string {
  return JSON.stringify(value)
}

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

function constructSystemPrompt(skills: SkillEntry[]): string {
  const skillDescriptions = skills.map(skill => {
    const { name, description } = skill.frontmatter;
    return `技能名称：${name}\n技能描述：${description}\n技能路径：${skill.path}`;
  }).join('\n\n');

  return `你是一个全能的AI助手，擅长使用各种工具来辅助获取信息，帮助你回答问题。\n\n以下是你可以使用的技能列表, 决定使用哪个技能后使用read_file工具来获取技能的详细内容：\n\n${skillDescriptions}\n\n当用户提问时，你会根据问题内容选择合适的技能来辅助回答。`;
}

export async function POST(req: Request) {
  const { messages }:{ messages: UIMessage[]} = await req.json();

  logMessages(messages)

  const response = await streamText({
    model: openai.chat('gemini-2.5-pro'),
    system: constructSystemPrompt(await skillsPromise),
    temperature: 0.2,
    messages: await convertToModelMessages(messages),
    tools: {
      read_file: readFileTool,
      exec_command: execCommandTool,
    },
    stopWhen: stepCountIs(5),
    // 流结束后触发，此时可以拿到完整的文本和 tool calls
    onFinish: (result) => {
      // console.log('\n=== Final Result ===')
      // console.log(result.response.messages.map(m=>m))
    },
  });

  return response.toUIMessageStreamResponse();
}
