#!/usr/bin/env node
/**
 * Serper 网络搜索脚本（Google 搜索，中文优化）
 * 推荐用法（Node.js 20.6+，无需 dotenv）：
 *   node --env-file=src/web/.env.local skills/web_search/scripts/search.mjs --query "关键词"
 *
 * 依赖环境变量：
 *   SERPER_API_KEY — serper.dev 的 API Key
 *   HTTPS_PROXY    — 可选，HTTP 代理（如 http://127.0.0.1:7890）
 */

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 若环境变量未注入，自动尝试读取 src/web/.env.local
if (!process.env.SERPER_API_KEY) {
  try {
    const envPath = resolve(process.cwd(), 'src/web/.env.local')
    const lines = readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    // 文件不存在时静默跳过
  }
}

const { values } = parseArgs({
  options: { query: { type: 'string' } },
})

const query = values.query
if (!query) {
  console.error('请提供搜索关键词，例如：node search.mjs --query "AI 最新进展"')
  process.exit(1)
}

const SERPER_API_KEY = process.env.SERPER_API_KEY
if (!SERPER_API_KEY) {
  console.error(JSON.stringify({
    success: false,
    message: '缺少环境变量 SERPER_API_KEY',
  }))
  process.exit(1)
}

// 注入今日日期，帮助处理"最近"、"今天"等相对时间表达
const today = new Date().toISOString().slice(0, 10)
const queryWithDate = `${query}（今天是 ${today}）`

// 如果设置了代理，通过 HTTPS_PROXY 环境变量传入
// Node 18+ 原生 fetch 不直接支持代理，需要 https-proxy-agent
// 这里先尝试直连，需要代理时请在项目目录 npm install https-proxy-agent 后取消注释下方代码
/*
import { HttpsProxyAgent } from 'https-proxy-agent'
const proxyUrl = process.env.HTTPS_PROXY
const fetchOptions = proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : {}
*/
const fetchOptions = {}

try {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    ...fetchOptions,
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: queryWithDate,
      gl: 'cn',       // 地区：中国
      hl: 'zh-cn',    // 界面语言：中文
      num: 8,
      tbs: 'qdr:m',   // 近一个月
    }),
  })

  const data = await res.json()

  const news = (data.topStories ?? []).slice(0, 3).map((r) => ({
    type: 'news',
    title: r.title,
    date: r.date ?? '',
    link: r.link,
  }))

  const organic = (data.organic ?? []).slice(0, 5).map((r, i) => ({
    type: 'organic',
    rank: i + 1,
    title: r.title,
    date: r.date ?? '日期未知',
    link: r.link,
    snippet: r.snippet,
  }))

  console.log(JSON.stringify({
    success: true,
    query,
    data: { news, organic },
  }, null, 2))
} catch (err) {
  console.log(JSON.stringify({
    success: false,
    message: err.message,
  }, null, 2))
  process.exit(1)
}
