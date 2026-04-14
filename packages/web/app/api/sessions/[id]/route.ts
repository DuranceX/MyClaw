/**
 * app/api/sessions/[id]/route.ts — 单个会话操作 Next.js 代理路由
 * =================================================================
 *
 * ## 职责
 *
 * 将浏览器对 /api/sessions/{id} 的 GET / PUT / DELETE 请求转发到 Python FastAPI 后端。
 *
 * ## 动态路由参数
 *
 * Next.js 15 中，动态路由的 params 是 Promise 类型，需要 await 才能拿到值：
 *
 * ```typescript
 * // Next.js 15 写法（params 是 Promise）
 * async function GET(_req, { params }: { params: Promise<{ id: string }> }) {
 *   const { id } = await params;
 * }
 *
 * // Next.js 14 写法（params 是普通对象，已废弃）
 * async function GET(_req, { params }: { params: { id: string } }) {
 *   const { id } = params;
 * }
 * ```
 *
 * 这是 Next.js 15 的 breaking change，升级时需要注意。
 *
 * ## 三个端点
 *
 * - GET  /api/sessions/{id} → 加载会话消息（切换会话时调用）
 * - PUT  /api/sessions/{id} → 保存会话消息（流结束后自动调用）
 * - DELETE /api/sessions/{id} → 删除会话（点击删除按钮时调用）
 */

import { getServerBaseUrl } from '@/lib/serverApi';

const backendUrl = (id: string) => `${getServerBaseUrl()}/api/sessions/${id}`;

/**
 * GET /api/sessions/{id} — 获取指定会话的消息列表。
 *
 * 返回格式：{ session_id: string, messages: UIMessage[] }
 * 前端拿到后直接 setMessages(data.messages) 恢复 useChat 状态。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(backendUrl(id), { cache: 'no-store' });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * PUT /api/sessions/{id} — 保存（覆盖写入）会话消息。
 *
 * 请求体：{ messages: UIMessage[] }（完整的消息列表）
 * 使用 req.text() 而不是 req.json()，直接透传原始 body，
 * 避免 JSON 解析再序列化带来的不必要开销。
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(backendUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(), // 直接透传，不解析
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * DELETE /api/sessions/{id} — 删除会话。
 *
 * 后端同时删除 JSONL 文件和索引条目。
 * 会话不存在时后端返回 404，前端静默处理。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(backendUrl(id), { method: 'DELETE' });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
