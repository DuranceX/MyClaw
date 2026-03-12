/**
 * Zod 示例：从"没有 Zod"到"有 Zod"的对比
 *
 * 场景：处理 AI 工具调用时传入的参数
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════
// Part 1：没有 Zod 时的痛点
// ═══════════════════════════════════════════════════════════

// 假设模型传来这样的参数（运行时是 unknown，你不知道里面是什么）
const rawInput: unknown = {
  city: "北京",
  unit: "celsius",
  days: "3", // ← 本来应该是 number，但模型传了 string
};

// 没有 Zod：要手写一堆类型检查
function validateWithoutZod(input: unknown) {
  if (typeof input !== "object" || input === null) {
    throw new Error("参数必须是对象");
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.city !== "string") throw new Error("city 必须是字符串");
  if (obj.unit !== undefined && obj.unit !== "celsius" && obj.unit !== "fahrenheit") {
    throw new Error("unit 必须是 celsius 或 fahrenheit");
  }
  if (obj.days !== undefined && typeof obj.days !== "number") {
    throw new Error("days 必须是数字");
  }

  // TypeScript 依然不知道类型，还要手动断言
  return obj as { city: string; unit?: string; days?: number };
}

// ═══════════════════════════════════════════════════════════
// Part 2：用 Zod 定义同样的规则
// ═══════════════════════════════════════════════════════════

const WeatherInputSchema = z.object({
  city: z.string().min(1, "城市名不能为空"),
  unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  days: z.number().int().min(1).max(7).optional(),
});

// 从 Schema 自动提取类型，不需要重复写 type/interface
type WeatherInput = z.infer<typeof WeatherInputSchema>;
//   ^^ 自动推导为：
//   {
//     city: string;
//     unit: "celsius" | "fahrenheit";
//     days?: number | undefined;
//   }

// ─────────────────────────────────────────────
// safeParse：验证失败不抛异常（推荐用法）
// ─────────────────────────────────────────────
console.log("=== safeParse 示例 ===");

const validResult = WeatherInputSchema.safeParse(rawInput);

if (validResult.success) {
  // 类型安全！validResult.data 是 WeatherInput 类型
  console.log("✅ 验证通过:", validResult.data);
  // 注意：days 传入的是字符串 "3"，但 schema 要求 number
  // 所以这里会验证失败（Zod 默认不做类型转换）
} else {
  console.log("❌ 验证失败:");
  validResult.error.errors.forEach((err) => {
    console.log(`  路径: ${err.path.join(".")}, 错误: ${err.message}`);
  });
}

// 修正数据，days 改为 number
const fixedInput = { city: "北京", unit: "celsius" as const, days: 3 };
const fixedResult = WeatherInputSchema.safeParse(fixedInput);
if (fixedResult.success) {
  console.log("✅ 修正后验证通过:", fixedResult.data);
}

// ─────────────────────────────────────────────
// 默认值：unit 缺失时自动填充 "celsius"
// ─────────────────────────────────────────────
console.log("\n=== 默认值示例 ===");
const withDefault = WeatherInputSchema.safeParse({ city: "上海" });
if (withDefault.success) {
  console.log("unit 默认值:", withDefault.data.unit); // "celsius"
}

// ═══════════════════════════════════════════════════════════
// Part 3：describe() —— 给 AI SDK 提供字段说明
// ═══════════════════════════════════════════════════════════
//
// 在工具调用场景中，describe() 的内容会作为参数说明传给模型
// 模型依据这个说明来决定传什么值

console.log("\n=== AI Tool 场景的 Schema ===");

const ToolSchema = z.object({
  city: z.string()
    .min(1)
    .describe("城市名称，例如：北京、上海、纽约"),  // ← 模型会看到这个说明

  unit: z.enum(["celsius", "fahrenheit"])
    .default("celsius")
    .describe("温度单位，默认摄氏度"),

  days: z.number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe("查询未来几天的天气，1-7 天，默认只查今天"),
});

// 在 Vercel AI SDK 中直接这样用：
//
// tool({
//   description: "查询城市天气",
//   parameters: ToolSchema,   // ← 直接传 schema
//   execute: async (input) => {
//     // input 已经是验证过的 { city, unit, days }，类型安全
//   }
// })

// ═══════════════════════════════════════════════════════════
// Part 4：transform —— 验证 + 转换一步完成
// ═══════════════════════════════════════════════════════════

console.log("\n=== transform 示例 ===");

// 场景：接收字符串形式的日期，转换成 Date 对象
const DateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须是 YYYY-MM-DD")
  .transform((val) => new Date(val));

type DateOutput = z.infer<typeof DateSchema>; // Date（不是 string）

const dateResult = DateSchema.safeParse("2026-03-12");
if (dateResult.success) {
  console.log("转换后的 Date 对象:", dateResult.data);
  console.log("类型是 Date:", dateResult.data instanceof Date);
}

// ═══════════════════════════════════════════════════════════
// Part 5：refine —— 跨字段的复杂验证
// ═══════════════════════════════════════════════════════════

console.log("\n=== refine 示例 ===");

// 场景：日期范围，结束日期必须晚于开始日期
const DateRangeSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  {
    message: "结束日期必须晚于开始日期",
    path: ["endDate"], // 错误标注在 endDate 字段上
  }
);

const rangeResult = DateRangeSchema.safeParse({
  startDate: "2026-03-12",
  endDate: "2026-03-01",  // ← 早于开始日期，应该失败
});

if (!rangeResult.success) {
  console.log("❌ 日期范围验证失败:", rangeResult.error.errors[0].message);
}
