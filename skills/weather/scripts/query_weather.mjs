#!/usr/bin/env node
/**
 * 和风天气查询脚本
 * 推荐用法（利用 Node.js 20.6+ 内置 --env-file，无需安装 dotenv）：
 *   node --env-file=packages/web/.env.local skills/weather/scripts/query_weather.mjs --city 北京
 *
 * 依赖环境变量：
 *   QWEATHER_API_KEY  — 和风天气 API Key
 *   QWEATHER_API_HOST — 和风天气域名（免费版：devapi.qweather.com，付费版另行配置）
 */

import { parseArgs } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fallbackEnvPaths = [
  resolve(process.cwd(), 'packages/server/.env'),
  resolve(process.cwd(), 'packages/web/.env.local'),
]

// 若环境变量未注入，自动尝试读取 server/web 的本地 env 文件（纯 Node 内置，无需 dotenv）
if (!process.env.QWEATHER_API_KEY) {
  for (const envPath of fallbackEnvPaths) {
    try {
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
      // 文件不存在时静默跳过，后续由环境变量检查兜底报错
    }
  }
}

const { values } = parseArgs({
  options: { city: { type: 'string' } },
})

const city = values.city
if (!city) {
  console.error('请提供城市名称，例如：node query_weather.mjs --city 北京')
  process.exit(1)
}

const API_KEY = process.env.QWEATHER_API_KEY
const API_HOST = process.env.QWEATHER_API_HOST

if (!API_KEY || !API_HOST) {
  console.error(JSON.stringify({
    success: false,
    message: '缺少环境变量 QWEATHER_API_KEY 或 QWEATHER_API_HOST',
  }))
  process.exit(1)
}

// 统一 fetch 封装：先取 text，再解析 JSON，失败时输出原始内容便于排查
async function fetchJson(url) {
  const res = await fetch(url.toString())
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(`API 返回空响应（HTTP ${res.status}），URL: ${url}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`API 返回非 JSON 内容（HTTP ${res.status}）：\n${text.slice(0, 300)}`)
  }
}

// Step 1: 城市名 → LocationID（GEO API 固定走 geoapi.qweather.com）
async function lookupLocation(cityName) {
  const url = new URL(`https://${API_HOST}/geo/v2/city/lookup`)
  url.searchParams.set('location', cityName)
  url.searchParams.set('range', 'cn')
  url.searchParams.set('number', '1')
  url.searchParams.set('lang', 'zh')
  url.searchParams.set('key', API_KEY)

  const data = await fetchJson(url)

  if (data.code !== '200' || !data.location?.length) {
    throw new Error(`找不到城市「${cityName}」（错误码：${data.code}）`)
  }

  return data.location[0].id
}

// Step 2: LocationID → 实时天气
async function fetchWeatherNow(locationId) {
  const url = new URL(`https://${API_HOST}/v7/weather/now`)
  url.searchParams.set('location', locationId)
  url.searchParams.set('lang', 'zh')
  url.searchParams.set('unit', 'm')
  url.searchParams.set('key', API_KEY)

  const data = await fetchJson(url)

  if (data.code !== '200') {
    throw new Error(`天气查询失败（错误码：${data.code}）`)
  }

  return data.now
}

try {
  const locationId = await lookupLocation(city)
  const now = await fetchWeatherNow(locationId)

  console.log(JSON.stringify({
    success: true,
    data: {
      city,
      temp: now.temp,
      feelsLike: now.feelsLike,
      text: now.text,
      windDir: now.windDir,
      windScale: now.windScale,
      humidity: now.humidity,
      precip: now.precip,
      vis: now.vis,
    },
  }, null, 2))
} catch (err) {
  console.log(JSON.stringify({
    success: false,
    message: err.message,
  }, null, 2))
  process.exit(1)
}
