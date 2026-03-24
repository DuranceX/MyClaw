import { tool } from 'ai'
import { z } from 'zod'
import { fetchServerJson } from '@/lib/serverApi'

export const readFileTool = tool({
  description: '根据相对路径读取项目根目录下的文件内容。适合查看源代码、配置文件、文档等文本文件。',
  inputSchema: z.object({
    file_path: z
      .string()
      .describe('相对于项目根目录的文件路径，例如 skills/weather/SKILL.md 或 packages/web/package.json'),
  }),
  execute: async ({ file_path }) => {
    try {
      return await fetchServerJson<{
        success: boolean
        file_path?: string
        content?: string
        error?: string
      }>('/api/files/read', {
        method: 'POST',
        body: JSON.stringify({ file_path }),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `读取失败：${message}` }
    }
  },
})
