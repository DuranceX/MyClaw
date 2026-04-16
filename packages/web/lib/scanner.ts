/**
 * src/skills/scanner.ts
 *
 * 扫描根目录 skills/ 下所有 SKILL.md，解析 frontmatter，返回技能索引。
 *
 * 使用方式（从任意位置 import）：
 *   import { scanSkills } from '../skills/scanner'
 *   const skills = await scanSkills(projectRoot)
 *
 * 或直接运行查看输出：
 *   npx tsx src/skills/scanner.ts
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string
  description: string
  /** 其他可选字段，如 compatibility */
  [key: string]: string
}

export interface SkillEntry {
  /** SKILL.md 相对于项目根目录的路径，例如 skills/weather/SKILL.md */
  path: string
  frontmatter: SkillFrontmatter
}

// ── Frontmatter 解析 ──────────────────────────────────────────────────────────

/**
 * 从文件内容中提取 --- 包裹的 frontmatter 原始文本。
 * 返回 null 表示文件没有 frontmatter。
 */
function extractFrontmatterBlock(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match ? match[1] : null
}

/**
 * 解析 frontmatter 文本为键值对。
 *
 * 支持以下 YAML 子集：
 *   key: simple value         → { key: 'simple value' }
 *   key: >                    → 折叠多行字符串（YAML folded scalar）
 *     line1                      各行去除公共缩进后用空格拼接
 *     line2
 */
function parseFrontmatter(block: string): SkillFrontmatter {
  const result: Record<string, string> = {}
  const lines = block.split(/\r?\n/)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }

    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()

    if (rest === '>') {
      // YAML 折叠多行字符串：收集后续缩进行，拼接为单行
      const indentedLines: string[] = []
      i++
      while (i < lines.length) {
        const nextLine = lines[i]
        // 遇到无缩进的非空行，说明当前 key 结束
        if (nextLine.length > 0 && !/^\s/.test(nextLine)) break
        indentedLines.push(nextLine.trim())
        i++
      }
      // 过滤尾部空行，拼接（折叠 scalar 用空格连接各行）
      result[key] = indentedLines
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    } else {
      result[key] = rest
      i++
    }
  }

  return result as SkillFrontmatter
}

// ── 目录遍历 ──────────────────────────────────────────────────────────────────

/**
 * 递归查找指定目录下所有名为 SKILL.md 的文件，返回绝对路径列表。
 */
async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const results: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findSkillFiles(fullPath)
      results.push(...nested)
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath)
    }
  }

  return results
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

/**
 * 扫描项目根目录下 skills/ 文件夹中所有 SKILL.md，返回技能索引。
 *
 * @param projectRoot 项目根目录的绝对路径（含有 skills/ 子目录）
 */
export async function scanSkills(projectRoot: string): Promise<SkillEntry[]> {
  const skillsDir = join(projectRoot, '.skills')
  const skillFiles = await findSkillFiles(skillsDir)

  const entries: SkillEntry[] = []

  for (const absolutePath of skillFiles) {
    const content = await readFile(absolutePath, 'utf-8')
    const block = extractFrontmatterBlock(content)
    if (!block) continue // 没有 frontmatter 的文件跳过

    const frontmatter = parseFrontmatter(block)
    if (!frontmatter.name) continue // name 是必填字段

    entries.push({
      path: relative(projectRoot, absolutePath).replace(/\\/g, '/'), // Windows 兼容
      frontmatter,
    })
  }

  // 按 name 字母排序，保证输出稳定
  return entries.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name))
}

// ── 直接运行时打印索引（调试用）─────────────────────────────────────────────

// 判断是否作为入口文件直接执行（兼容 tsx / ts-node / 编译后的 js）
const isMain =
  process.argv[1]?.endsWith('scanner.ts') ||
  process.argv[1]?.endsWith('scanner.js')

if (isMain) {
  import('node:path').then(async ({ resolve, dirname }) => {
    import('node:url').then(async ({ fileURLToPath }) => {
      // __dirname 在 ESM 下不可用，用 fileURLToPath 兼容
      const here = typeof __dirname !== 'undefined'
        ? __dirname
        : dirname(fileURLToPath(import.meta.url))

      const projectRoot = resolve(here, '../../..')
      const skills = await scanSkills(projectRoot)
      console.log(JSON.stringify(skills, null, 2))
    })
  })
}
