# 项目说明

## 项目定位

本项目是一个面向**前端开发者**的 AI / Agent 开发学习项目，目标是通过实践掌握以下技术：

- **Vercel AI SDK**（当前重点）
- **FastAPI**（后端接口）
- **Tool Call**（函数调用 / 工具调用）
- 未来可能拓展：RAG、LangChain、向量数据库等

## 技术栈

- **AI SDK 版本**：Vercel AI SDK v6.x（`"ai": "^6.0.116"`）
- **前端框架**：Next.js（App Router）
- **语言**：TypeScript

## 回答风格要求

由于本项目以**学习为主要目的**，在协助时请遵守以下原则：

1. **清晰优先**：解释要清晰易懂，适合有前端背景但 AI 开发经验较少的开发者
2. **附带讲解**：不只给出代码，要说明"为什么这样写"、"这个 API 的作用是什么"
3. **指出版本差异**：AI SDK 各版本 API 变化较大，遇到版本相关问题要明确说明差异（如 v3 vs v5 vs v6 的变化）
4. **结合实际报错分析**：遇到错误时，帮助理解报错的根本原因，而不只是给出修复方案

## 常见注意事项

### Vercel AI SDK v6 关键 API

- `openai(modelId)` → 默认走 `/v1/responses` 端点（OpenAI 新 API）
- `openai.chat(modelId)` → 走 `/v1/chat/completions` 端点（兼容旧接口）
- `convertToModelMessages()` 是同步函数，不需要 `await`
- 环境变量：系统环境变量优先级**高于** `.env.local`，调试时注意检查

### 环境变量加载优先级（Next.js）

```
系统环境变量 > .env.local > .env
```
