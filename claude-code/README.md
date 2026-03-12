# Tool Call：传统函数接口 vs MCP 协议

本文档对应示例文件：
- `01-traditional-tool-call.ts` —— 传统 Tool Call 方式
- `02-mcp-tool-call.ts` —— MCP 方式

---

## 一句话总结区别

| | 传统函数接口 | MCP |
|---|---|---|
| 工具在哪里 | 本地代码（你的项目里） | 独立进程（可以是任何语言） |
| 谁来调度工具 | 你自己写的 agentic loop | Agent SDK 自动处理 |
| 工具能否复用 | 只能在本项目用 | 任何 AI 应用都能接入 |
| 适合场景 | 单个项目、需要精细控制 | 多项目共享、平台化工具 |

---

## 核心概念

### 什么是 Tool Call？

当你向 Claude 提问，Claude 判断需要外部数据（天气、搜索结果、数据库查询等）时，它不会自己"凭空想象"，而是返回一个 `tool_use` 请求，告诉你：

```
我需要调用 get_weather 工具，参数是 { city: "北京" }，请你帮我执行并把结果告诉我。
```

你的代码收到这个请求 → 执行工具 → 把结果返回给 Claude → Claude 基于结果生成最终回复。

这个"请求 → 执行 → 返回 → 继续"的过程，就是 **Agentic Loop（代理循环）**。

---

## 传统函数接口

### 工作流程

```
用户消息
  ↓
Claude 分析（Claude API）
  ↓
stop_reason = "tool_use"  →  你的代码执行工具函数  →  返回结果
  ↓
Claude 继续分析
  ↓
stop_reason = "end_turn"
  ↓
最终回复
```

### 代码结构

```typescript
// 1. 定义工具（JSON Schema）
const tools: Anthropic.Tool[] = [{
  name: "get_weather",
  description: "获取天气",
  input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
}];

// 2. 实现工具函数（本地代码）
async function getWeather({ city }) {
  return `${city} 当前晴，22°C`;
}

// 3. 手动写 agentic loop
while (true) {
  const response = await client.messages.create({ tools, messages });
  if (response.stop_reason === "end_turn") break;
  if (response.stop_reason === "tool_use") {
    // 执行工具，把结果塞回 messages
  }
}
```

### 优点
- **精细控制**：你决定每个工具调用是否真正执行（可以加审批、日志、限流）
- **无额外依赖**：只需要 `@anthropic-ai/sdk`
- **方便调试**：工具就是本地函数，断点随便加

### 缺点
- **重复代码**：每个项目都要自己写 agentic loop
- **不可复用**：工具和项目强绑定，其他 AI 应用无法共享

---

## MCP（Model Context Protocol）

### MCP 是什么？

MCP 是 Anthropic 于 2024 年提出的**开放标准协议**，目标是让工具可以像"插件"一样被任何 AI 应用接入。

类比理解：
- MCP Server ≈ USB 接口上的设备（U 盘、键盘、鼠标）
- AI 应用 ≈ 电脑
- MCP 协议 ≈ USB 标准

只要符合 MCP 协议，任何工具都可以接入任何支持 MCP 的 AI 应用（Claude、Cursor、Windsurf 等）。

### 工作流程

```
用户消息
  ↓
Agent SDK（query 函数）
  ↓
自动发现 MCP Server 提供的工具
  ↓
Claude 决定调用工具
  ↓
Agent SDK 通过 MCP 协议调用 Server
  ↓
MCP Server 执行工具，返回结果
  ↓
Claude 继续生成
  ↓
最终回复
（整个 loop 由 Agent SDK 自动处理）
```

### 两种使用方式

#### 方式一：外部 MCP Server（真正的 MCP）

```typescript
for await (const message of query({
  prompt: "访问 example.com",
  options: {
    mcpServers: {
      playwright: {
        command: "npx",      // 启动命令
        args: ["@playwright/mcp@latest"],  // 命令参数
        // Agent SDK 会自动启动这个进程，通过 stdio 与之通信
      },
    },
  },
})) { ... }
```

> 适用：使用社区已有的 MCP Server（如 Playwright、GitHub、Slack 等）

#### 方式二：进程内 MCP 工具（学习 / 开发）

```typescript
// 用 Zod 定义参数，更简洁
const myTool = tool("get_weather", "获取天气", { city: z.string() }, async (args) => {
  return { content: [{ type: "text", text: `${args.city} 晴，22°C` }] };
});

const server = createSdkMcpServer({ name: "my-server", tools: [myTool] });

for await (const message of query({
  prompt: "北京天气？",
  options: { mcpServers: { myTools: server } },
})) { ... }
```

> 适用：开发阶段自定义工具，不需要单独启动进程

### 优点
- **零 loop 代码**：Agent SDK 自动处理所有调度逻辑
- **工具即服务**：MCP Server 可以独立部署、多项目共享
- **生态丰富**：社区已有大量现成的 MCP Server（数据库、浏览器、Git、Slack...）

### 缺点
- **控制权减少**：工具执行是自动的，难以在调用前插入审批逻辑
- **调试复杂**：外部 MCP Server 是独立进程，调试比本地函数麻烦
- **依赖更多**：需要额外安装 `@anthropic-ai/claude-agent-sdk`

---

## 选择指南

```
你需要精细控制工具执行（审批、日志、条件执行）？
  └── YES → 传统 Tool Call（手动 loop）

你需要工具跨项目复用，或想接入社区 MCP 生态？
  └── YES → MCP

你只是在学习 / 快速验证想法？
  └── 两者都可以，但传统方式更容易理解底层
```

---

## 对比总结

```
传统 Tool Call                        MCP
────────────────────                  ────────────────────
工具 = 本地函数                        工具 = 独立进程/服务
你写 loop                             SDK 自动处理 loop
JSON Schema 定义参数                   Zod Schema / JSON Schema
只用 @anthropic-ai/sdk                用 @anthropic-ai/claude-agent-sdk
适合：精细控制 / 单个项目               适合：复用 / 平台化 / 社区生态
```

---

## 依赖安装

```bash
# 传统 Tool Call
npm install @anthropic-ai/sdk

# MCP 方式
npm install @anthropic-ai/claude-agent-sdk zod
# 如果用外部 MCP Server（以 Playwright 为例）
npx @playwright/mcp@latest  # 按需安装
```

---

## 延伸阅读

- [MCP 官方协议文档](https://modelcontextprotocol.io)
- [Claude Agent SDK 文档](https://platform.claude.com/docs/en/agent-sdk.md)
- [社区 MCP Server 列表](https://github.com/modelcontextprotocol)
