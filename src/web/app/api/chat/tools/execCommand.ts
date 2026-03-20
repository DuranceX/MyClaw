import { tool } from 'ai'
import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execAsync = promisify(exec)

// 命令在项目根目录下执行，与 readFile 保持一致
const PROJECT_ROOT = path.resolve(process.cwd(), '../..')

export const execCommandTool = tool({
  description: '在项目根目录下执行命令行命令，返回 stdout 和 stderr。适合运行脚本、查看目录结构、执行构建命令等操作。',
  inputSchema: z.object({
    command: z.string().describe('要执行的 shell 命令，例如 ls skills/ 或 python3 skills/get_user_db/scripts/query_user.py --id 1'),
    timeout_ms: z.number().optional().describe('超时时间（毫秒），默认 10000ms'),
  }),
  execute: async ({ command, timeout_ms = 10000 }) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: PROJECT_ROOT,
        timeout: timeout_ms,
        // 限制输出大小，避免超大输出撑爆 context
        maxBuffer: 1024 * 1024, // 1MB
      })
      return {
        success: true,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }
    } catch (err: unknown) {
      const e = err as { message?: string; stdout?: string; stderr?: string }
      return {
        success: false,
        command,
        error: e.message ?? String(err),
        stdout: e.stdout?.trim() ?? '',
        stderr: e.stderr?.trim() ?? '',
      }
    }
  },
})
