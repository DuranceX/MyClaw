/**
 * 传统函数接口（Tool Call）示例
 *
 * 这是最基础的工具调用方式：
 * - 工具定义和实现都写在本地代码里
 * - 你自己实现"执行工具"的逻辑
 * - 需要手动处理 Claude 的 tool_use 请求 → 执行 → 返回结果 的循环
 */

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// ─────────────────────────────────────────────
// Step 1: 定义工具的 JSON Schema
// Claude 会根据这个 schema 决定"是否调用这个工具"以及"传什么参数"
// ─────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "获取某个城市当前的天气信息",
    input_schema: {
      type: "object" as const,
      properties: {
        city: {
          type: "string",
          description: "城市名称，例如：北京、上海",
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "温度单位，默认 celsius（摄氏度）",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "search_web",
    description: "在网络上搜索信息",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
      },
      required: ["query"],
    },
  },
];

// ─────────────────────────────────────────────
// Step 2: 实现工具的真实执行逻辑（你自己写的函数）
// ─────────────────────────────────────────────
async function executeWeather(input: {
  city: string;
  unit?: string;
}): Promise<string> {
  // 真实场景这里会调用天气 API
  // 这里用模拟数据演示
  const unit = input.unit === "fahrenheit" ? "°F" : "°C";
  const temp = input.unit === "fahrenheit" ? "72" : "22";
  return `${input.city} 当前天气：晴，温度 ${temp}${unit}，湿度 60%`;
}

async function executeSearch(input: { query: string }): Promise<string> {
  // 真实场景这里会调用搜索 API（如 Bing、Google）
  return `搜索"${input.query}"的结果：[模拟搜索结果1, 模拟搜索结果2, ...]`;
}

// ─────────────────────────────────────────────
// Step 3: 工具调度器 —— 根据工具名称决定调用哪个函数
// ─────────────────────────────────────────────
async function dispatchTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_weather":
      return executeWeather(input as { city: string; unit?: string });
    case "search_web":
      return executeSearch(input as { query: string });
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ─────────────────────────────────────────────
// Step 4: 手动实现 Agentic Loop（核心！）
//
// 整个对话流程：
//   用户消息
//     → Claude 决定调用工具（stop_reason = "tool_use"）
//     → 我们执行工具，把结果塞回消息
//     → Claude 继续生成（stop_reason = "end_turn"）
//     → 结束
// ─────────────────────────────────────────────
async function runWithTraditionalToolCall(userMessage: string) {
  console.log("用户:", userMessage);
  console.log("─".repeat(50));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // 循环处理，直到 Claude 不再请求工具
  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      tools: tools,
      messages: messages,
    });

    // 打印 Claude 的文字回复（如果有）
    for (const block of response.content) {
      if (block.type === "text") {
        console.log("Claude:", block.text);
      }
    }

    // 如果 Claude 已经回答完毕，退出循环
    if (response.stop_reason === "end_turn") {
      break;
    }

    // 如果 Claude 想调用工具
    if (response.stop_reason === "tool_use") {
      // 把 Claude 的回复（包含 tool_use 块）加入消息历史
      messages.push({ role: "assistant", content: response.content });

      // 处理所有工具调用（Claude 可能同时请求多个工具）
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`\n[调用工具] ${block.name}`);
          console.log("[工具参数]", JSON.stringify(block.input, null, 2));

          // 执行工具，获取结果
          const result = await dispatchTool(
            block.name,
            block.input as Record<string, unknown>
          );

          console.log("[工具结果]", result);

          // 把结果打包成 tool_result 格式
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id, // 必须与请求的 id 对应！
            content: result,
          });
        }
      }

      // 把所有工具结果作为 user 消息加入历史（这是规定的格式）
      messages.push({ role: "user", content: toolResults });

      // 继续循环 → Claude 会根据工具结果生成最终回复
    }
  }
}

// ─────────────────────────────────────────────
// 运行示例
// ─────────────────────────────────────────────
runWithTraditionalToolCall(
  "北京今天天气怎么样？同时帮我搜索一下 Vercel AI SDK 的最新动态"
).catch(console.error);
