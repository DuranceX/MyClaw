export interface SkillEntry {
  path: string
  frontmatter: {
    name: string
    description: string
    extra?: Record<string, string>
  }
}

/**
 * 获取 Next.js 服务端路由调用 Python 后端时使用的基础地址。
 *
 * 返回值：
 *   当前配置的后端地址；开发环境下默认回退到本地 FastAPI 服务。
 */
function getServerBaseUrl(): string {
  return process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:8000'
}

/**
 * 向 Python 后端发送 JSON 请求，并返回带类型的 JSON 数据。
 *
 * @param pathname 后端路径，例如 `/api/skills`。
 * @param init 透传给 `fetch` 的可选请求配置。
 * @returns 解析后的 JSON 响应，类型为 `T`。
 *
 * 关键逻辑：
 *   通过 `cache: 'no-store'` 避免开发阶段读到过期的技能索引或工具结果。
 */
export async function fetchServerJson<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getServerBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Server request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}
