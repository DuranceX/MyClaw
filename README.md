# AI Chat Bot Monorepo

这个仓库正在从单一 Next.js 项目重构为 `web + python` 共存的 monorepo。

## 当前目录结构

```text
packages/
  web/      Next.js 前端，负责聊天 UI
  server/   FastAPI 后端，负责技能索引、文件读取、命令执行、LLM 编排
skills/     本地技能定义
src/web/    旧版前端目录，暂时保留用于迁移对照
```

## 开发方式

根目录启动前后端：

```bash
npm run dev
```

单独启动前端：

```bash
npm run dev:web
```

单独启动 Python 服务：

```bash
cd packages/server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## 环境变量

前端和后端现在共用 `packages/web/.env.local` 里的大多数变量，`packages/server` 启动时会自动读取这份文件。

共享变量：

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `QWEATHER_API_HOST`
- `QWEATHER_API_KEY`
- `SERPER_API_KEY`

前端附加变量：

- `AI_SERVER_BASE_URL`，默认 `http://127.0.0.1:8000`

后端附加变量：

- `WEB_ORIGIN`，默认 `http://127.0.0.1:3000`

如果后端需要单独覆盖配置，可以复制 `packages/server/.env.example` 为 `packages/server/.env`，该文件会在共享配置之后加载。

## 学习路线图

下面的路线图以“从聊天 Demo 逐步演进到 Mini-OpenClaw”为目标设计。顺序上优先强化 Agent 内核，再逐步扩展记忆、安全、异步调度和多 Agent 编排，避免过早陷入系统复杂度。

### 任务 1：把单 Agent 内核做扎实

目标：从“会调用工具的聊天机器人”升级为“能稳定执行任务的单 Agent”。

建议顺序：

1. 为聊天主循环补充任务状态模型，例如 `pending`、`running`、`waiting_approval`、`failed`、`done`
2. 为每一步执行记录 trace，至少记录模型输出、工具名、输入参数、结果、耗时和失败原因
3. 增加工具失败重试、最大步数限制和熔断逻辑，避免死循环
4. 增加更贴近 coding agent 的工具，如 `search_code`
5. 增加安全版文件修改工具，如 `patch_file`
6. 在前端展示 step 状态、工具调用过程和失败信息

子任务清单：

- 子任务 1.1：梳理现有 `stream_chat()` 的执行阶段和状态边界
- 子任务 1.2：定义任务状态与 step 数据结构
- 子任务 1.3：实现 trace 记录与查询接口
- 子任务 1.4：实现 `search_code`
- 子任务 1.5：实现 `patch_file`
- 子任务 1.6：补充前端状态展示

完成标志：

- Agent 能按步骤执行一个任务，而不是只返回一段文本
- 可以清楚看到每次工具调用的输入、输出和失败位置

#### 任务 1 详细实施方案

这一阶段建议拆成 6 个连续迭代，必须按顺序推进。前一个迭代没有跑通前，不建议直接跳后面的能力。

##### 迭代 1：梳理聊天主循环与状态边界

目标：先把当前单轮请求里到底发生了哪些阶段说清楚，为后面的状态机做准备。

涉及文件：

- `packages/server/app/services/chat.py`
- `packages/server/app/models.py`
- `packages/web/app/chat.tsx`

实施顺序：

1. 盘点 `stream_chat()` 当前有哪些阶段，例如 `start`、`start-step`、`tool-input-available`、`tool-output-available`、`finish-step`、`finish`
2. 定义“任务级状态”和“step 级状态”分别是什么
3. 明确哪些状态只存在于 SSE 流里，哪些状态需要落盘或持久化
4. 在 README 或代码注释里补一张状态流转说明

建议产出：

- 一张任务状态流转表
- 一张 step 状态流转表

验收方式：

- 你可以完整解释一次请求从用户输入到模型结束之间经历了哪些状态
- 你可以区分“消息事件”和“任务状态”这两个概念

##### 迭代 2：给任务和 step 定义结构化数据模型

目标：不要再让执行状态散落在代码流程里，而是收敛成明确的数据结构。

涉及文件：

- `packages/server/app/models.py`
- `packages/server/app/services/chat.py`

实施顺序：

1. 在 `models.py` 中增加任务状态枚举和 step 状态枚举
2. 增加 `TaskTrace`、`StepTrace`、`ToolTrace` 一类的数据模型
3. 让 `stream_chat()` 在内部维护这些结构，而不是只临时拼接 SSE 事件
4. 明确哪些字段是最小必需字段

建议最小字段：

- `task_id`
- `status`
- `started_at`
- `finished_at`
- `step_index`
- `step_type`
- `tool_name`
- `input`
- `output`
- `error`
- `duration_ms`

验收方式：

- 即使不看日志文本，也能从结构化对象中还原一次任务执行过程

##### 迭代 3：实现 trace 记录与查询接口

目标：让单 Agent 的执行过程可观测，而不是只能靠终端打印排查。

涉及文件：

- `packages/server/app/services/chat.py`
- `packages/server/app/main.py`
- `packages/server/app/models.py`

实施顺序：

1. 先实现最小版内存 trace 存储，不要一开始就引入数据库
2. 为每次请求生成 `task_id`
3. 在每个 step 开始、工具调用、工具返回、异常退出时写 trace
4. 增加查询接口，例如 `GET /api/tasks/{task_id}` 或 `GET /api/traces/{task_id}`
5. 定义统一的返回结构，方便前端后面消费

建议先记录的事件：

- 模型开始
- 模型返回文本
- 模型请求工具
- 工具执行开始
- 工具执行成功
- 工具执行失败
- 达到最大步数
- 用户请求结束

验收方式：

- 已完成的任务可以按 `task_id` 回放执行过程
- 出错时能快速定位卡在模型、工具还是状态流转

##### 迭代 4：补 `search_code` 工具

目标：从“通用命令执行”过渡到“面向代码库的专用工具”，这是走向 coding agent 的关键一步。

涉及文件：

- `packages/server/app/services/chat.py`
- `packages/server/app/models.py`
- 新增 `packages/server/app/services/search.py`

实施顺序：

1. 设计 `search_code` 的输入参数，例如 `query`、`glob`、`limit`
2. 在服务层封装代码搜索逻辑，优先使用 `rg`
3. 在 `TOOL_SCHEMAS` 中注册 `search_code`
4. 为工具输出做裁剪，避免把整仓库结果一次性塞给模型
5. 给模型 prompt 补充“什么时候优先用 `search_code`，什么时候再 `read_file`”

建议输入输出：

- 输入：`query`、`glob`、`limit`
- 输出：匹配文件路径、行号、命中片段

验收方式：

- 用户问“聊天主循环在哪”“技能扫描在哪”时，Agent 能先搜索再读文件

##### 迭代 5：补 `patch_file` 工具

目标：让 Agent 第一次具备受控修改代码的能力。

涉及文件：

- `packages/server/app/services/chat.py`
- `packages/server/app/services/files.py`
- `packages/server/app/models.py`

实施顺序：

1. 先定义最小版补丁协议，不要一开始支持复杂 diff
2. 只允许修改工作区内文本文件
3. 为写入前后增加校验，例如目标文件是否存在、内容是否匹配预期
4. 返回修改前后摘要，而不是整文件内容
5. 为后续权限系统预留风险标记字段

建议最小能力：

- 替换整文件内容
- 按字符串查找并替换

暂时不要做：

- 跨文件批量修改
- 二进制文件处理
- 过于复杂的通用 diff 合并

验收方式：

- Agent 可以完成一个受控的小改动，例如改按钮文案或补一段注释

##### 迭代 6：前端展示 step 与 trace

目标：把单 Agent 的执行过程从“黑盒”变成“可以观察和解释的过程”。

涉及文件：

- `packages/web/app/chat.tsx`
- `packages/web/lib/serverApi.ts`
- 可能新增 `packages/web/app/tasks/[taskId]/page.tsx`

实施顺序：

1. 在当前聊天 UI 里显示更明确的 step 类型和状态
2. 工具执行中显示 `tool_name` 和输入参数摘要
3. 工具失败时显示错误信息与所在 step
4. 如果已经实现 trace 查询接口，再做一个简单任务详情页
5. 明确区分“模型文本输出”和“系统执行事件”

验收方式：

- 用户可以从 UI 看出 Agent 当前在搜索、读文件、执行命令还是修改文件
- 出错时能直接看到出错步骤，而不只是“请求失败”

#### 任务 1 的阶段验收任务

完成任务 1 后，至少应该能稳定完成下面 4 个演示任务：

1. “帮我找出聊天主循环入口，并说明它如何处理工具调用”
2. “帮我找出 skills 扫描逻辑，并列出当前有哪些技能”
3. “把聊天页输入框 placeholder 改成另一句文案”
4. “如果改坏了，再根据错误信息继续修复一次”

如果以上 4 个任务做不到，说明任务 1 还没有真正完成，不建议继续推进任务 2。

### 任务 2：建立 Memory v1

目标：把当前“只靠 messages 数组”的上下文管理，升级成“短期上下文 + 长期记忆”。

建议顺序：

1. 引入 SQLite，持久化保存会话、消息、step trace 和摘要
2. 约定短期上下文窗口，例如最近 10 到 20 轮对话
3. 超过阈值时自动触发摘要压缩任务
4. 将旧消息刷入数据库，把摘要重新放回上下文
5. 用户追问旧内容时，根据关键词或任务标签召回摘要

子任务清单：

- 子任务 2.1：设计会话表、消息表、摘要表
- 子任务 2.2：把运行时消息持久化到 SQLite
- 子任务 2.3：实现“超过 N 轮自动摘要”
- 子任务 2.4：实现摘要回填到上下文
- 子任务 2.5：实现旧记忆召回

完成标志：

- 长对话不会无限增长到上下文窗口里
- 用户追问旧任务时，系统能找回已经压缩过的信息

### 任务 3：建立权限模型与安全边界

目标：先建立安全制度，再逐步升级到更强的执行隔离。

建议顺序：

1. 为工具建立风险分级，例如 `safe`、`ask`、`deny`
2. 为 `read_file`、`patch_file`、`exec_command` 增加路径和命令边界
3. 对高风险动作引入审批状态
4. 记录所有高风险工具调用
5. 在基础权限模型跑通后，再考虑 Docker 或 Podman 沙盒

子任务清单：

- 子任务 3.1：整理工具风险分级表
- 子任务 3.2：为文件读写增加工作区沙箱
- 子任务 3.3：为命令执行增加白名单或限制规则
- 子任务 3.4：实现 `waiting_approval` 挂起机制
- 子任务 3.5：评估并实现容器化沙盒执行

完成标志：

- Agent 不会无边界地读写文件或执行命令
- 高风险操作可以被拦截、记录和审批

### 任务 4：把同步聊天升级为异步任务系统

目标：让 Agent 不再只能“用户发一句，我答一句”，而是能在后台持续处理任务。

建议顺序：

1. 把“同步请求直接执行”改为“提交任务并返回任务 ID”
2. 建立后台 worker，异步消费任务
3. 提供任务状态查询接口
4. 增加定时触发器，让 Agent 可以被主动唤醒
5. 再接入外部 Webhook，如 Telegram、Slack 或企业微信

子任务清单：

- 子任务 4.1：设计任务表与任务状态流转
- 子任务 4.2：实现本地异步 worker
- 子任务 4.3：实现任务查询和结果回放接口
- 子任务 4.4：实现 Cron 定时任务
- 子任务 4.5：实现一个真实 IM 渠道接入

完成标志：

- 后端可以快速接收任务，不必阻塞等待完整结果
- Agent 可以被定时触发，主动执行任务

### 任务 5：多 Agent 与长程规划

目标：在单 Agent 稳定的前提下，进化到可并发、可拆解的大任务执行系统。

建议顺序：

1. 在单 Agent 中补齐 `plan -> act -> observe -> retry -> abort -> summarize`
2. 给每类任务设定重试上限和熔断规则
3. 将复杂任务拆成可并发的子任务
4. 为子任务分配独立上下文和输出结构
5. 汇总多个子 Agent 结果，生成统一结论

子任务清单：

- 子任务 5.1：实现规划与重规划机制
- 子任务 5.2：实现最大重试次数和熔断器
- 子任务 5.3：定义子任务输入输出协议
- 子任务 5.4：实现子 Agent 并发执行
- 子任务 5.5：实现结果归并与总结

完成标志：

- Agent 能处理长程任务，而不是只做一步问答
- 复杂任务可以拆给多个子 Agent 并汇总结果

## 推荐执行顺序

请严格按下面顺序推进：

1. 任务 1：单 Agent 内核
2. 任务 2：Memory v1
3. 任务 3：权限模型与安全边界
4. 任务 4：异步任务系统
5. 任务 5：多 Agent 与长程规划

这个顺序的核心原则是：

- 先把 Agent 本体做稳定
- 再解决长期记忆
- 再补安全护栏
- 然后再接入异步事件世界
- 最后挑战多 Agent 编排
