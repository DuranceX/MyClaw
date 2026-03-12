/**
 * MCP（Model Context Protocol）工具调用示例
 *
 * MCP 是 Anthropic 提出的开放协议，核心思想是：
 * - 工具不再是本地代码，而是独立运行的"MCP Server"进程
 * - Claude（通过 Agent SDK）通过标准协议与 MCP Server 通信
 * - 工具可以跨语言、跨团队、跨应用复用
 *
 * 本示例展示两种使用 MCP 的方式：
 *   1. 连接外部 MCP Server（通过 npx 启动进程）
 *   2. 在进程内定义 MCP 工具（用 createSdkMcpServer）
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// 方式一：连接外部 MCP Server
// ─────────────────────────────────────────────────────────────
// 外部 MCP Server 是独立的进程（可以是任何语言写的）。
// Agent SDK 会自动通过 stdio 与之通信。
//
// 这里使用官方的 Playwright MCP Server，它提供了浏览器操作能力：
// - browser_navigate（导航到 URL）
// - browser_screenshot（截图）
// - browser_click（点击元素）
// 等等...
//
// 你不需要关心这些工具是怎么实现的，只需要告诉 Claude "有这个 server"
// ═══════════════════════════════════════════════════════════════
async function exampleExternalMcpServer() {
  console.log("=== 方式一：连接外部 MCP Server（Playwright 浏览器自动化）===");
  console.log("─".repeat(60));

  for await (const message of query({
    prompt: "请访问 https://example.com，告诉我页面标题是什么",
    options: {
      // mcpServers 的 key 是你给这个 server 起的名字（随意命名）
      // command + args 是启动这个 MCP Server 进程的命令
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["@playwright/mcp@latest"],
          // 注意：MCP Server 进程由 Agent SDK 自动启动和管理
          // Claude 会自动发现 Playwright 提供的所有工具
        },
      },
    },
  })) {
    if ("result" in message) {
      console.log("结果:", message.result);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 方式二：在进程内定义 MCP 工具（In-Process MCP）
// ─────────────────────────────────────────────────────────────
// 如果你不想启动单独的进程，可以用 createSdkMcpServer 在当前进程内
// 定义工具，效果和外部 MCP Server 一样，但更轻量。
//
// 这是学习和开发阶段最常用的方式，因为：
// - 不需要单独部署 Server
// - 调试方便（就是普通的 TypeScript 函数）
// - 工具逻辑可以访问本地变量和模块
// ═══════════════════════════════════════════════════════════════
async function exampleInProcessMcpTools() {
  console.log("\n=== 方式二：进程内 MCP 工具定义 ===");
  console.log("─".repeat(60));

  // ─── 定义 MCP 工具 ───
  // tool() 函数签名：tool(名称, 描述, 参数Schema, 执行函数)
  // 参数 Schema 使用 Zod 定义，比 JSON Schema 更简洁
  const getWeatherTool = tool(
    "get_weather",
    "获取指定城市的天气信息",
    {
      city: z.string().describe("城市名称，如：北京、上海"),
      unit: z
        .enum(["celsius", "fahrenheit"])
        .optional()
        .describe("温度单位，默认摄氏度"),
    },
    async (args) => {
      // 这里是真实的工具执行逻辑
      // args 已经经过 Zod 验证，类型安全
      const unit = args.unit === "fahrenheit" ? "°F" : "°C";
      const temp = args.unit === "fahrenheit" ? "72" : "22";
      const result = `${args.city} 当前天气：晴，温度 ${temp}${unit}，湿度 60%`;

      // MCP 工具的返回格式是固定的 content 数组
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  const searchWebTool = tool(
    "search_web",
    "搜索互联网上的信息",
    {
      query: z.string().describe("搜索关键词"),
    },
    async (args) => {
      // 模拟搜索结果
      const result = `搜索"${args.query}"的结果：[MCP 工具返回的搜索结果...]`;
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // ─── 创建 MCP Server（in-process）───
  // 把工具注册到一个虚拟的 MCP Server 里
  const myMcpServer = createSdkMcpServer({
    name: "my-tools-server",
    tools: [getWeatherTool, searchWebTool],
  });

  // ─── 运行 Agent，传入 MCP Server ───
  for await (const message of query({
    prompt: "北京今天天气怎么样？顺便帮我搜索 Vercel AI SDK 的最新动态",
    options: {
      mcpServers: {
        // key 是 server 的名字，value 是 createSdkMcpServer 返回的对象
        myTools: myMcpServer,
      },
    },
  })) {
    if ("result" in message) {
      console.log("结果:", message.result);
    } else if (message.type === "assistant") {
      // 可以监听中间消息，看 Claude 的思考过程
      console.log("[Claude 消息]", JSON.stringify(message, null, 2));
    }
  }
}

// ─────────────────────────────────────────────
// 运行示例（注释掉你不想运行的部分）
// ─────────────────────────────────────────────
async function main() {
  // 方式一：需要安装 @playwright/mcp，且比较耗时，默认注释
  // await exampleExternalMcpServer();

  // 方式二：进程内工具，直接可以运行
  await exampleInProcessMcpTools();
}

main().catch(console.error);
