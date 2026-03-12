# Zod 完全指南

## Zod 是什么？

Zod 是一个 **TypeScript 优先的数据验证库**。它的核心作用是：

1. **定义数据的结构和规则**（Schema）
2. **在运行时验证数据是否符合规则**
3. **自动推导出 TypeScript 类型**（不需要重复写类型定义）

一句话：**写一次 Schema，同时得到验证逻辑 + TypeScript 类型。**

---

## 为什么需要 Zod？

TypeScript 的类型检查是**编译时**的，运行时并不存在。

```typescript
// TypeScript 类型 ← 只在编译时有效
type User = {
  name: string;
  age: number;
};

// 运行时从 API 拿到的数据，TypeScript 无法保证它真的符合 User 类型
const user = await fetch('/api/user').then(res => res.json()) as User;
// 如果 API 返回 { name: "Alice", age: "28" }（age 是字符串）
// TypeScript 不会报错，但运行时可能出 bug
```

Zod 解决的就是这个问题——**在运行时真正验证数据**。

---

## 在 AI 开发中为什么重要？

在 Tool Call（工具调用）场景中，模型传过来的参数需要在运行时验证：

```typescript
// Vercel AI SDK + Zod：Schema 既是参数定义，也是运行时验证
const tools = {
  getWeather: tool({
    parameters: z.object({
      city: z.string(),
      unit: z.enum(['celsius', 'fahrenheit']),
    }),
    execute: async ({ city, unit }) => {
      // 这里的 city 和 unit 已经经过验证，类型安全
    }
  })
}

// Anthropic SDK 的 betaZodTool 同理
const getWeather = betaZodTool({
  inputSchema: z.object({ city: z.string() }),
  run: async ({ city }) => { ... }
})
```

---

## 基础类型

### 原始类型

```typescript
import { z } from 'zod';

z.string()      // 字符串
z.number()      // 数字
z.boolean()     // 布尔值
z.null()        // null
z.undefined()   // undefined
z.any()         // 任意类型（慎用）
z.unknown()     // 未知类型（比 any 安全）
```

### 对象

```typescript
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string(),
});

// 自动推导类型，不需要额外写 type/interface
type User = z.infer<typeof UserSchema>;
// 等价于：type User = { name: string; age: number; email: string }
```

### 数组

```typescript
z.array(z.string())   // string[]
z.string().array()    // 同上，链式写法

z.array(z.object({
  id: z.number(),
  name: z.string(),
}))
```

### 枚举

```typescript
// 方式一：z.enum（推荐，值是字符串字面量）
z.enum(['celsius', 'fahrenheit'])

// 方式二：z.nativeEnum（配合 TypeScript enum 使用）
enum Direction { Up = 'UP', Down = 'DOWN' }
z.nativeEnum(Direction)
```

### 联合类型

```typescript
z.union([z.string(), z.number()])
// 等价于：string | number

// 简写
z.string().or(z.number())
```

---

## 字符串验证

```typescript
z.string().min(1)                    // 最小长度 1
z.string().max(100)                  // 最大长度 100
z.string().length(6)                 // 精确长度 6
z.string().email()                   // 邮箱格式
z.string().url()                     // URL 格式
z.string().uuid()                    // UUID 格式
z.string().regex(/^\d{4}-\d{2}-\d{2}$/)  // 自定义正则
z.string().startsWith('https')       // 以 https 开头
z.string().endsWith('.com')          // 以 .com 结尾
z.string().trim()                    // 验证前先 trim
z.string().toLowerCase()             // 转小写
```

## 数字验证

```typescript
z.number().min(0)          // 最小值
z.number().max(100)        // 最大值
z.number().positive()      // 正数（> 0）
z.number().negative()      // 负数（< 0）
z.number().nonnegative()   // 非负数（>= 0）
z.number().int()           // 整数
z.number().multipleOf(5)   // 5 的倍数
z.number().finite()        // 非 Infinity
```

---

## 可选和默认值

```typescript
// 可选字段（值可以是 undefined）
z.object({
  name: z.string(),
  nickname: z.string().optional(),  // string | undefined
})

// 可空字段（值可以是 null）
z.string().nullable()   // string | null

// 两者都可以
z.string().nullish()    // string | null | undefined

// 默认值（字段缺失时使用默认值）
z.object({
  name: z.string(),
  role: z.string().default('user'),
  active: z.boolean().default(true),
})
```

---

## 嵌套对象

```typescript
const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zipCode: z.string().regex(/^\d{6}$/),
});

const UserSchema = z.object({
  name: z.string(),
  address: AddressSchema,           // 直接嵌套
  addresses: z.array(AddressSchema), // 数组嵌套
});

type User = z.infer<typeof UserSchema>;
```

---

## 验证数据：parse vs safeParse

```typescript
const Schema = z.object({ age: z.number().min(0) });

// parse：验证失败会抛出异常
try {
  const data = Schema.parse({ age: -1 });
} catch (e) {
  // e 是 ZodError，包含详细的错误信息
  console.log(e.errors);
  // [{ path: ['age'], message: 'Number must be greater than or equal to 0' }]
}

// safeParse：验证失败不抛异常，返回结果对象（推荐）
const result = Schema.safeParse({ age: -1 });

if (result.success) {
  console.log(result.data);   // 验证通过，拿到数据
} else {
  console.log(result.error);  // 验证失败，拿到错误
}
```

---

## 自定义错误信息

```typescript
z.object({
  name: z.string({ required_error: '姓名不能为空' }),
  age: z.number()
    .min(0, '年龄不能为负数')
    .max(150, '年龄不能超过150岁'),
  email: z.string().email('请输入有效的邮箱地址'),
})
```

---

## 数据转换（transform）

Zod 不只是验证，还可以在验证通过后转换数据：

```typescript
// 验证后转换类型
const Schema = z.string().transform(val => parseInt(val));
type T = z.infer<typeof Schema>; // number（不是 string！）

// 实用例子：接收字符串，转成 Date 对象
const DateSchema = z.string().transform(val => new Date(val));

// 结合 refine 做复杂验证
const PasswordSchema = z.object({
  password: z.string().min(8),
  confirm: z.string(),
}).refine(
  data => data.password === data.confirm,
  { message: '两次密码不一致', path: ['confirm'] }
);
```

---

## 从 Schema 提取类型：z.infer

这是 Zod 最重要的特性之一——**类型定义和验证逻辑只写一次**：

```typescript
// ❌ 没有 Zod 时：要写两遍
type User = { name: string; age: number };
function validateUser(data: unknown): User { /* 手写验证 */ }

// ✅ 有 Zod：只写一次
const UserSchema = z.object({ name: z.string(), age: z.number() });
type User = z.infer<typeof UserSchema>;  // 自动推导
// 修改 Schema，类型自动同步更新
```

---

## 在 AI SDK 中的典型用法对比

```typescript
// Vercel AI SDK
tool({
  parameters: z.object({
    city: z.string().describe('城市名称'),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async ({ city, unit }) => { ... }
})

// Anthropic betaZodTool
betaZodTool({
  name: 'get_weather',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  run: async ({ city, unit }) => { ... }
})

// MCP in-process tool（Agent SDK）
tool('get_weather', '获取天气', {
  city: z.string().describe('城市名称'),
  unit: z.enum(['celsius', 'fahrenheit']).optional(),
}, async ({ city, unit }) => { ... })
```

三种 SDK 的工具参数定义都用 Zod，但**传入方式略有不同**——这也是为什么理解 Zod 本身很重要，而不只是照着示例抄。

---

## 安装

```bash
npm install zod
```

---

## 延伸阅读

- [Zod 官方文档](https://zod.dev)
- [Zod GitHub](https://github.com/colinhacks/zod)
