/**
 * app/api/sessions/route.ts — 会话列表 Next.js 代理路由
 * ========================================================
 *
 * ## 职责
 *
 * 将浏览器对 GET /api/sessions 的请求转发到 Python FastAPI 后端。
 *
 * ## 为什么需要这个代理？
 *
 * 浏览器直接请求 Python 后端（localhost:8000）会遇到 CORS 问题。
 * 通过 Next.js API 路由代理，浏览器只需要请求同源的 /api/sessions，
 * 由服务端（Next.js）转发到后端，绕过 CORS 限制。
 *
 * 这与 /api/chat 的架构保持一致，所有后端请求都通过 Next.js 代理。
 *
 * ## 数据流
 *
 * 浏览器 → GET /api/sessions → Next.js → GET {BACKEND_URL}/api/sessions → Python FastAPI
 *                                                                              ↓
 * 浏览器 ← SessionMeta[] ←────────────── Next.js ←──────────────────── SessionMeta[]
 */

import { getServerBaseUrl } from '@/lib/serverApi';

// 后端 URL 用函数包装，确保每次请求时动态读取环境变量
// 而不是在模块加载时固定（避免环境变量未加载的问题）
const BACKEND = () => `${getServerBaseUrl()}/api/sessions`;

export async function GET() {
  // cache: 'no-store' 禁用 Next.js 的 fetch 缓存，确保每次都拿到最新数据
  // 会话列表是动态数据，不应该被缓存
  const res = await fetch(BACKEND(), { cache: 'no-store' });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
