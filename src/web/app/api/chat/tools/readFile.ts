import { tool } from 'ai'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

// process.cwd() 在 Next.js 中是 src/web/，往上两级就是项目根目录
const PROJECT_ROOT = path.resolve(process.cwd(), '../..')

export const readFileTool = tool({
  description: '根据相对路径读取项目根目录下的文件内容。适合查看源代码、配置文件、文档等文本文件。',
  inputSchema: z.object({
    file_path: z
      .string()
      .describe('相对于项目根目录的文件路径，例如 skills/weather/SKILL.md 或 src/web/package.json'),
  }),
  execute: async ({ file_path }) => {
    // 防止路径穿越攻击（如 ../../etc/passwd）
    const absolutePath = path.resolve(PROJECT_ROOT, file_path)
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
      return { success: false, error: `路径不合法：${file_path}` }
    }

    try {
      const content = await readFile(absolutePath, 'utf-8')
      return { success: true, file_path, content }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `读取失败：${message}` }
    }
  },
})
