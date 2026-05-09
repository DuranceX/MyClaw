# Python 流式传输与 LLM 交互

这篇文档记录本次将聊天主流程迁移到 Python 后端后的关键实现，重点覆盖两部分：

- Python 的流式传输
- Python 与 LLM 的交互及工具调用循环

当前相关代码主要位于：

- `packages/server/app/main.py`
- `packages/server/app/services/chat.py`
- `packages/web/app/api/chat/route.ts`

## 背景

迁移前，聊天接口的核心编排逻辑放在 Next.js 路由里，前端服务端负责：

- 构造 system prompt
- 调用模型
- 注册工具
- 处理工具调用循环
- 把 AI SDK 的流式响应直接返回给浏览器

迁移后，这些职责收口到 Python 后端，Next.js 只保留一层很薄的代理。这样做的目的主要有：

- 让 LLM 交互逻辑与 Python 侧的本地能力放在一起维护
- 减少前后端来回分散编排的复杂度
- 方便后续继续把更多能力统一接入 Python

## 整体链路

当前聊天链路可以概括为：

1. 浏览器继续请求 `/api/chat`
2. Next.js 路由把请求原样转发给 Python 的 `/api/chat`
3. Python 后端读取历史消息，补充 system prompt
4. Python 调用 LLM 接口
5. 如果模型请求工具，Python 直接执行工具并把结果写回上下文
6. Python 通过 SSE 持续把事件流发回前端
7. 前端 `useChat()` 按 AI SDK 的消息流协议更新界面

对应代码：

- Next 代理入口：`packages/web/app/api/chat/route.ts`
- Python 流式入口：`packages/server/app/main.py`
- Python 聊天主循环：`packages/server/app/services/chat.py`

## Python 流式传输

### 什么是 SSE

这里使用的是 SSE，也就是 `Server-Sent Events`。

可以把它理解成一条保持打开状态的 HTTP 连接，服务端不是一次性返回完整结果，而是可以不断往连接里写入事件。前端收到一段就处理一段，因此很适合聊天场景里的：

- 文本逐步输出
- 工具调用状态更新
- 错误信息实时反馈

本项目里，Python 后端通过 `StreamingResponse` 返回 `text/event-stream`，从而实现流式响应。

### FastAPI 入口

入口在 `packages/server/app/main.py`：

```python
@app.post("/api/chat")
def chat(payload: ChatRequest):
    return StreamingResponse(
        stream_chat(payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "x-vercel-ai-ui-message-stream": "v1",
            "x-accel-buffering": "no",
        },
    )
```

这里有两个关键点：

- `StreamingResponse(stream_chat(payload), ...)`
  把一个生成器交给 FastAPI，生成器每产出一段字节，FastAPI 就往前端发送一段。
- `x-vercel-ai-ui-message-stream: v1`
  这是为了兼容前端 `useChat()` 依赖的 AI SDK UI 消息流协议。

### yield 在这里的作用

`stream_chat()` 是一个生成器函数。生成器函数不会像普通函数那样一次性 `return` 完整结果，而是通过 `yield` 多次产出内容。

例如：

```python
def gen():
    yield "第一段"
    yield "第二段"
```

它的含义不是“最终返回一个大字符串”，而是“先交出第一段，暂停；下次再继续交出第二段”。

在本项目里，`stream_chat()` 每次 `yield` 的不是普通文本，而是一条 SSE 事件对应的字节串。

### SSE 事件格式

`packages/server/app/services/chat.py` 中的 `_sse_line()` 负责把一个 Python 字典编码成 SSE 事件：

```python
def _sse_line(chunk: Dict[str, Any]) -> bytes:
    return f"data: {_serialize_json(chunk)}\n\n".encode("utf-8")
```

这里的关键格式是：

- 每条事件以 `data: ` 开头
- 事件末尾用空行结束，也就是 `\n\n`

前端会把每条 `data: ...` 解析成一段 JSON 事件。

### 文本是如何流出去的

文本输出使用 `_emit_text_chunks()`：

```python
def _emit_text_chunks(text: str) -> Iterator[bytes]:
    text_id = f"text-{uuid.uuid4().hex}"
    yield _sse_line({"type": "text-start", "id": text_id})
    if text:
        yield _sse_line({"type": "text-delta", "id": text_id, "delta": text})
    yield _sse_line({"type": "text-end", "id": text_id})
```

也就是说，一段文本会被包装成三类事件：

- `text-start`
- `text-delta`
- `text-end`

目前这里是把完整文本作为一次 `text-delta` 发出去。虽然还不是逐字输出，但协议已经是流式结构，后续如果要做到更细粒度的 token streaming，可以继续在这里拆分。

### 整个 stream_chat() 的输出节奏

`stream_chat()` 的主要输出顺序大致如下：

1. `start`
2. `start-step`
3. 若干文本事件或工具事件
4. `finish-step`
5. `finish`

如果模型触发工具调用，则中间还会插入：

- `tool-input-available`
- `tool-output-available`
- 或 `tool-output-error`

这正是前端 UI 能显示“工具调用中”和“工具执行结果”的原因。

### 为什么前端几乎不用改

因为 Python 输出的事件格式对齐了 AI SDK 的 UI 消息流协议，所以浏览器侧仍然可以继续使用原来的 `useChat()`。

Next.js 的 `packages/web/app/api/chat/route.ts` 现在只是做一件事：

- 接收浏览器请求
- 转发给 Python `/api/chat`
- 原样把流返回浏览器

因此前端页面组件没有感知到“模型调用从 Node 迁到了 Python”。

## Python 与 LLM 的交互

### 聊天主循环

Python 侧的核心逻辑都在 `packages/server/app/services/chat.py` 的 `stream_chat()` 里。

它不是简单“调一次模型然后结束”，而是一个带工具循环的多轮过程：

1. 准备 system prompt
2. 把前端消息历史转换成模型消息格式
3. 调用模型
4. 如果模型要调用工具，则执行工具并把工具结果写回上下文
5. 再次调用模型
6. 直到模型返回最终文本，或者达到最大轮数限制

这里用 `MAX_STEPS = 5` 来限制单轮请求中的最大工具循环次数，避免模型陷入反复调用工具的死循环。

### system prompt 的构造

`construct_system_prompt()` 会先读取当前技能列表，再拼接成一段系统提示词，告诉模型：

- 当前有哪些本地技能
- 如果需要技能详情，可以调用 `read_file`
- 回答问题时可以借助这些工具

这样模型既知道“有什么能力”，也知道“如何进一步读取技能定义”。

### 为什么要做消息格式转换

前端传来的不是直接给 OpenAI Chat Completions 用的消息，而是 AI SDK 的 `UIMessage` 格式。它包含：

- `role`
- `parts`
- `step-start`
- `tool-*` 类型的片段

而上游模型接口需要的是另一种结构，例如：

- `system`
- `user`
- `assistant`
- `tool`
- `tool_calls`

所以需要 `convert_ui_messages_to_model_messages()` 来做中间转换。

### convert_ui_messages_to_model_messages() 做了什么

这个函数做了几件关键事情：

- 把 `system` 和 `user` 的文本部分直接拼成普通消息
- 把 assistant 的一个 step 内的文本和 tool call 视为同一轮 assistant 发言
- 把工具执行结果转换成独立的 `tool` 角色消息
- 忽略还处于流式输入中的未完成 tool input

这样做的目的是为了让下一轮模型请求拿到一份“对它来说合法且完整”的上下文。

### 如何调用模型

`_call_model()` 会读取环境变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- 可选的 `OPENAI_MODEL`

然后向：

- `OPENAI_BASE_URL/chat/completions`

发起一个标准的 Chat Completions 请求。

发送内容包括：

- `model`
- `temperature`
- `messages`
- `tools`

这里的 `tools` 就是 Python 侧声明的 `TOOL_SCHEMAS`。

### Python 侧的工具声明与执行

当前在 `TOOL_SCHEMAS` 里暴露了两个工具：

- `read_file`
- `exec_command`

模型只会知道这两个工具的名字、描述和参数 schema。

真正执行时，则进入 `_execute_tool()`：

- `read_file` 最终调用 `read_repo_file()`
- `exec_command` 最终调用 `run_command()`

这样模型侧的“工具描述”和服务端的“工具实现”都收口在 Python 一侧，维护起来更集中。

### 为什么要把工具结果写回 messages

当模型发起工具调用后，Python 不只是执行一下工具然后把结果发给前端，还会把工具结果追加回 `messages`：

- 先追加 assistant 的 `tool_calls`
- 再追加 tool 的输出消息

这样下一轮再调用模型时，模型能看到：

- 自己刚才调用了什么工具
- 工具返回了什么结果

如果不把这些内容写回上下文，模型就无法基于工具结果继续推理。

## 一个简化的执行例子

假设用户问：“帮我看看 `skills/weather/SKILL.md` 里写了什么？”

Python 侧的处理过程会接近这样：

1. `stream_chat()` 收到前端消息
2. 拼好 system prompt 和历史消息
3. 调用模型
4. 模型返回一个 `read_file` 工具调用
5. Python 发出 `tool-input-available`
6. Python 执行 `read_repo_file("skills/weather/SKILL.md")`
7. Python 发出 `tool-output-available`
8. Python 把这次工具调用和工具结果都写回 `messages`
9. Python 再调用一次模型
10. 模型基于读到的文件内容生成最终回答
11. Python 发出文本相关事件和 `finish`

## 这次迁移后的职责划分

当前职责划分已经比较清晰：

- `packages/web/app/chat.tsx`
  负责聊天界面展示
- `packages/web/app/api/chat/route.ts`
  负责把 `/api/chat` 转发到 Python
- `packages/server/app/main.py`
  负责暴露 FastAPI 路由和流式响应入口
- `packages/server/app/services/chat.py`
  负责消息转换、模型调用、工具执行和 SSE 输出

## 后续可以继续优化的方向

这次迁移已经完成主链路迁移，但后面还有一些自然的演进方向：

- 把 `_stream_model()` 从手写 HTTP 请求抽象成单独的 provider 层
- 支持更多工具类型，而不只是 `read_file` 和 `exec_command`
- 给工具调用和模型请求加更完整的日志
- 把错误类型区分得更细，前端展示更友好

---

## 升级：从非流式改为真正的流式请求

> 本节记录后续对 `_call_model()` 的重构，将其改为真正的流式请求。

### 问题背景

原始实现中，`_call_model()` 使用的是普通的同步 POST 请求：

```python
with httpx.Client(proxy=proxy, timeout=60) as client:
    resp = client.post(...)
resp.raise_for_status()
return resp.json()
```

这意味着 Python 会等待模型把**完整响应**生成完毕后，才开始处理和转发。这带来两个问题：

1. **超时风险**：对话上下文越长，模型生成时间越长，60s 的硬编码超时很容易触发。
2. **用户体验差**：前端要等到模型全部生成完才能看到第一个字，没有逐字流出的效果。

### 改动：_call_model → _stream_model

将 `_call_model()` 重写为 `_stream_model()`，改为流式请求：

```python
def _stream_model(messages: List[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    payload = {
        ...
        "stream": True,   # 关键：告诉模型接口开启流式输出
    }

    # connect_timeout=30s，read_timeout=None（流式不限单次读超时）
    timeout = httpx.Timeout(connect=30, read=None, write=30, pool=10)

    with httpx.Client(proxy=proxy, timeout=timeout) as client:
        with client.stream("POST", url, json=payload, headers=...) as resp:
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                yield json.loads(data)   # 每个 chunk 解析后立即 yield
```

几个关键点：

- **`"stream": True`**：请求体里加这个字段，模型接口就会以 SSE 格式逐 chunk 返回，而不是等全部生成完再返回。
- **`client.stream()`**：httpx 的流式上下文管理器，不会等响应体全部下载完，而是边收边处理。
- **`resp.iter_lines()`**：逐行读取响应体，每行是一条 `data: {...}` 格式的 SSE 事件。
- **超时策略**：连接超时 30s，读超时设为 `None`。读超时不能设置，因为流式响应中两个 chunk 之间的间隔可能很长，设了读超时会误触发。

### 改动：stream_chat() 中的实时 delta 输出

原来 `stream_chat()` 是等 `_call_model()` 返回完整结果后，再一次性发出文本事件：

```python
response = _call_model(messages)
text = response["choices"][0]["message"]["content"]
yield from _emit_text_chunks(text)   # 一次性发出全部文本
```

改为流式后，每收到一个 chunk 就立即 yield 给前端：

```python
for chunk in _stream_model(messages):
    delta = chunk["choices"][0]["delta"]
    content = delta.get("content") or ""
    if content:
        if not text_started:
            yield _sse_line({"type": "text-start", "id": text_id})
            text_started = True
        accumulated_text += content
        yield _sse_line({"type": "text-delta", "id": text_id, "delta": content})
```

这样前端就能看到文字逐步出现，而不是等待后一次性显示。

### 工具调用 delta 的聚合

流式模式下，工具调用的参数不是一次性返回的，而是分多个 chunk 逐步传输。每个 chunk 里的 `tool_calls` 只包含增量片段，需要按 `index` 聚合成完整的工具调用：

```python
tool_calls_map: Dict[str, Dict[str, Any]] = {}  # index -> 聚合中的 tool_call

for tc_delta in (delta.get("tool_calls") or []):
    idx = str(tc_delta.get("index", 0))
    if idx not in tool_calls_map:
        tool_calls_map[idx] = {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
    entry = tool_calls_map[idx]
    if tc_delta.get("id"):
        entry["id"] = tc_delta["id"]
    fn = tc_delta.get("function") or {}
    if fn.get("name"):
        entry["function"]["name"] += fn["name"]
    if fn.get("arguments"):
        entry["function"]["arguments"] += fn["arguments"]
```

等整个流结束后，再从 `tool_calls_map` 里取出完整的工具调用列表，执行工具。

### 改动前后对比

| 维度 | 改动前 | 改动后 |
|------|--------|--------|
| 请求方式 | 同步 POST，等待完整响应 | 流式 POST，逐 chunk 处理 |
| 超时策略 | 总超时 60s | 连接超时 30s，读超时不限 |
| 文本输出 | 等全部生成完再发 | 每个 token 立即转发 |
| 工具调用 | 直接从完整响应取 | 流式聚合后再执行 |
| 超时风险 | 长对话容易触发 60s 超时 | 不受生成时长影响 |

## 小结

这次改动的本质是把“聊天编排核心”迁到了 Python 后端。

具体来说：

- Python 通过 `StreamingResponse + yield` 实现 SSE 流式传输
- Python 通过 `chat completions + tools` 完成 LLM 交互与工具调用循环
- Next.js 从“编排者”变成了“代理层”
- 前端 UI 基本不用改，继续消费兼容 AI SDK 的流式事件

这样后续如果继续扩展技能、工具或者模型接入，主要改动点都会集中在 Python 侧，整体结构会更清晰。
