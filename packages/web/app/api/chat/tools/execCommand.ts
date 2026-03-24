import { tool } from 'ai'
import { z } from 'zod'
import { fetchServerJson } from '@/lib/serverApi'

export const execCommandTool = tool({
  description: '在项目根目录下执行命令行命令，返回 stdout 和 stderr。适合运行脚本、查看目录结构、执行构建命令等操作。',
  inputSchema: z.object({
    command: z.string().describe('要执行的 shell 命令，例如 ls skills/ 或 python3 skills/get_user_db/scripts/query_user.py --id 1'),
    timeout_ms: z.number().optional().describe('超时时间（毫秒），默认 10000ms'),
  }),
  execute: async ({ command, timeout_ms = 10000 }) => {
    try {
      return await fetchServerJson<{
        success: boolean
        command: string
        stdout: string
        stderr: string
        error?: string
      }>('/api/commands/exec', {
        method: 'POST',
        body: JSON.stringify({ command, timeout_ms }),
      })
    } catch (err: unknown) {
      return {
        success: false,
        command,
        error: err instanceof Error ? err.message : String(err),
        stdout: '',
        stderr: '',
      }
    }
  },
})
