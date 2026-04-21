# 项目说明

## 项目定位

本项目是一个面向**前端开发者**的 AI Agent 开发学习项目，通过实践掌握以下技术：

- **Vercel AI SDK v6**（前端流式对话）
- **FastAPI + Python**（后端 Agent 逻辑）
- **Tool Call / Function Calling**（工具调用）
- **Skills 系统**（基于 Markdown 的可扩展技能描述）

## 项目结构

```
ai-chat-bot/
├── config.yaml          # 统一配置（LLM provider、工具 API Key），不提交 git
├── config.example.yaml  # 配置模板，提交 git
├── .skills/             # 技能目录，每个子目录是一个 skill
│   └── cloud-mail/      # 邮件查询技能
│       ├── SKILL.md     # 技能描述（LLM 读取）
│       └── scripts/     # 技能脚本
├── packages/
│   ├── web/             # Next.js 前端
│   └── server/          # FastAPI 后端
└── doc/dev/             # 开发文档
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js（App Router）+ TypeScript |
| AI SDK | Vercel AI SDK v6.x（`"ai": "^6.0.116"`） |
| 后端 | FastAPI + Python 3.12 |
| 配置 | pydantic-settings + config.yaml |
| 进程管理 | pm2（服务器） |

## 配置管理

所有 API Key 统一在 `config.yaml` 中管理，不使用 `.env.local`。

```yaml
providers:
  bilibili:
    api_key: "bsk-xxx"
    base_url: "http://llmapi.bilibili.co/v1"
  grok:
    api_key: "xai-xxx"
    base_url: "https://api.x.ai/v1"

llm:
  provider: "bilibili"   # 切换 provider 只改这两行
  model: "claude-4.6-opus"

tools:
  qweather:
    api_key: "xxx"
    api_host: "xxx"
  serper:
    api_key: "xxx"
  cloud_mail:
    token: "xxx"
```

配置优先级：`系统环境变量 > .env 文件 > config.yaml > 字段默认值`

## 编码风格

- **参数位置**：多于两个参数时改为竖向排列
- **注释风格**：新增或修改的文件需要添加详细的中文注释，包括：
  - 文件头部说明模块职责、设计背景、关键决策
  - 每个函数/组件说明"为什么这样设计"，而不只是"做了什么"
  - 非显而易见的逻辑要解释原理

## 回答风格要求

由于本项目以**学习为主要目的**，在协助时请遵守以下原则：

1. **清晰优先**：解释要清晰易懂，适合有前端背景但 AI 开发经验较少的开发者
2. **附带讲解**：不只给出代码，要说明"为什么这样写"、"这个 API 的作用是什么"
3. **指出版本差异**：AI SDK 各版本 API 变化较大，遇到版本相关问题要明确说明差异
4. **结合实际报错分析**：遇到错误时，帮助理解报错的根本原因，而不只是给出修复方案

## 常见注意事项

### Vercel AI SDK v6 关键 API

- `openai(modelId)` → 默认走 `/v1/responses` 端点（OpenAI 新 API）
- `openai.chat(modelId)` → 走 `/v1/chat/completions` 端点（兼容旧接口）
- `convertToModelMessages()` 是异步函数，需要 `await`
- 工具调用错误由后端通过 `tool-output-error` 事件传递给模型，前端不需要重复注入

### 工具调用错误处理

- 工具执行失败 → 后端写入 `role: "tool"` 消息 → 模型下轮感知并调整
- LLM 请求本身失败 → 前端展示错误，用户重试
- 前端不应将错误消息追加到 `messages` 状态（会污染发给模型的对话历史）

### Skills 系统

- 每个 skill 是 `.skills/<name>/SKILL.md` + 可选脚本
- LLM 通过 `read_file` 工具读取 SKILL.md 获取详细用法
- 脚本所需的 API Key 由 `exec_command` 工具从 `config.yaml` 自动注入为环境变量

---

### Security Warning（重要）

**`exec_command` 工具特殊说明：**

> **⚠️ 警告**：`exec_command` 可以执行任意 shell 命令，**不受 `security:file_access_root` 文件访问限制**。
>
> 这是当前系统中权限最高的工具，请谨慎使用。
> 后续应逐步将其封装为更细粒度的安全工具（如 `git_commit`、`run_npm`、`list_directory` 等），减少直接暴露原始 shell 执行能力。

当前安全策略：
- 文件读写类操作已通过 `read_file`、`write_file`、`edit_file` 等工具进行限制
- `exec_command` 仍为全权限状态，用于执行 `git`、`node` 等必要命令
- 未来规划：增加命令白名单 + 路径沙箱

---

## 服务器部署

服务器使用 **pm2** 管理进程。

### 常用命令

```bash
pm2 list                 # 查看所有服务状态
pm2 restart all          # 重启全部
pm2 restart web          # 只重启前端
pm2 restart server       # 只重启后端
pm2 logs server          # 查看后端日志
pm2 logs --lines 100     # 最近 100 行
pm2 save                 # 保存进程列表（重启后自动恢复）
```

### Python 后端更新依赖

服务器系统 Python 被保护（PEP 668），必须使用 venv：

```bash
cd /home/llm/MyClaw/packages/server
.venv/bin/pip install -e .
pm2 restart server
```

pm2 启动后端时需指定 venv 内的解释器：

```js
// ecosystem.config.js
{
  name: 'server',
  script: 'packages/server/.venv/bin/uvicorn',
  args: 'app.main:app --host 0.0.0.0 --port 8000',
  cwd: '/home/llm/MyClaw',
}
```
