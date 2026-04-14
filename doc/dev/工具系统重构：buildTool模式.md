# 工具系统重构：buildTool 模式

这篇文档记录工具调用模块的重构过程，参考了 Claude Code 的 `buildTool` 工厂模式，将原本耦合在 `chat.py` 中的工具定义和执行逻辑拆分为独立的工具模块。

当前相关代码位于：

- `packages/server/app/tools/base.py` — 核心数据结构
- `packages/server/app/tools/read_file.py` — read_file 工具
- `packages/server/app/tools/exec_command.py` — exec_command 工具
- `packages/server/app/tools/__init__.py` — 工具注册表入口
- `packages/server/app/services/chat.py` — 调用方（已简化）

---

## 重构前的问题

原来的实现把工具的"长什么样"（JSON Schema）和"怎么跑"（执行逻辑）全部堆在 `chat.py` 里：

```python
# chat.py 里手写 JSON Schema
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "..."}
                },
                ...
            }
        }
    },
    ...
]

# chat.py 里 if/else 分发执行
def _execute_tool(tool_name, tool_input):
    if tool_name == "read_file":
        ...
    elif tool_name == "exec_command":
        ...
```

这样做有几个问题：

1. **新增工具要改两处**：schema 列表和 if/else 分支，容易遗漏
2. **schema 和代码可能不一致**：手写 JSON Schema 和实际执行代码是分开维护的
3. **没有参数验证**：用 `tool_input.get("file_path", "")` 取参数，类型错误只有运行时才能发现
4. **难以独立测试**：测试单个工具需要 mock 整个 `chat.py`

---

## 参考：Claude Code 的 buildTool 模式

Claude Code（TypeScript）的工具系统核心是 `buildTool()` 工厂函数（`src/Tool.ts`）：

```typescript
// 每个工具通过 buildTool 创建，包含完整的自描述信息
export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,  // 安全默认值（fail-closed）
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
}

// 安全默认值：未声明的属性选择更保守的行为
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: () => false,   // 默认不安全
  isReadOnly: () => false,           // 默认可能写入
  isDestructive: () => false,
  checkPermissions: (input) => Promise.resolve({ behavior: 'allow', updatedInput: input }),
}
```

每个工具是一个独立文件（`tools/FileReadTool/`、`tools/BashTool/`），包含自己的 Zod schema、执行逻辑和安全属性。

---

## 重构后的设计

### 核心数据结构：ToolDef

`tools/base.py` 中定义了 `ToolDef` dataclass，对应 Claude Code 的 `buildTool` 返回值：

```python
@dataclass
class ToolDef:
    name: str
    description: str
    input_model: Type[BaseModel]       # Pydantic model，自动生成 JSON Schema + 参数验证
    execute: Callable[[BaseModel], Any]
    is_read_only: bool = False         # fail-closed：默认假设可能写入
    is_destructive: bool = False

    def to_openai_schema(self) -> Dict[str, Any]:
        # 从 input_model 自动生成 OpenAI function calling 格式
        schema = self.input_model.model_json_schema()
        schema.pop("title", None)   # 去掉 Pydantic 元数据，减少 token 消耗
        schema.pop("$defs", None)
        return {"type": "function", "function": {"name": ..., "parameters": schema}}
```

**为什么用 Pydantic model 而不是手写 JSON Schema？**

Pydantic 的 `model_json_schema()` 会自动从 model 定义生成 JSON Schema，schema 和代码永远同步，不会出现"schema 说有这个参数但代码里没处理"的情况。同时入参会被自动验证，类型错误有明确的报错信息。

**为什么 `is_read_only` 默认 `False`？**

这是 fail-closed 原则：未声明的工具被当作"可能写入"，选择更保守的行为。Claude Code 的 `TOOL_DEFAULTS` 也是同样的设计。未来加权限检查时，这个字段就是判断依据。

### 注册表：ToolRegistry

```python
class ToolRegistry:
    def register(self, tool: ToolDef) -> None: ...

    def get_schemas(self) -> List[Dict]:
        # 返回所有工具的 OpenAI schema，直接传给 LLM 的 tools 参数
        return [tool.to_openai_schema() for tool in self._tools.values()]

    def execute(self, name: str, raw_input: Dict) -> Tuple[str, Any]:
        # 统一处理参数验证和执行异常，保证返回格式一致
        tool = self._tools.get(name)
        validated_input = tool.input_model.model_validate(raw_input)  # Pydantic 验证
        result = tool.execute(validated_input)
        return "tool-output-available", result
```

`execute()` 统一捕获 `ValidationError` 和其他异常，转成 `(event_type, result)` 元组返回。这样 `chat.py` 拿到的格式永远一致，不需要关心每个工具的错误处理细节。

### 工具独立文件

每个工具一个文件，结构固定：Input model → 执行函数 → 工具实例。

```python
# tools/read_file.py
class ReadFileInput(BaseModel):
    file_path: str = Field(description="相对于项目根目录的文件路径")

def _execute(input: ReadFileInput) -> ReadFileResponse:
    content = read_repo_file(input.file_path)  # input.file_path 有类型提示，IDE 能补全
    return ReadFileResponse(success=True, content=content)

READ_FILE_TOOL = ToolDef(
    name="read_file",
    description="...",
    input_model=ReadFileInput,
    execute=_execute,
    is_read_only=True,   # 明确声明：只读操作
)
```

### 显式注册

`tools/__init__.py` 显式注册所有工具，对外暴露 `registry` 单例：

```python
registry = ToolRegistry()
registry.register(READ_FILE_TOOL)
registry.register(EXEC_COMMAND_TOOL)
```

**为什么显式注册而不是"自注册"？**

自注册依赖 Python 的 import 副作用：工具文件被 import 时自动注册到全局 registry。这种隐式行为的问题是：如果某个工具文件没被 import，它就不会被注册，很难排查。显式注册在 `__init__.py` 里一眼就能看到所有工具。

### chat.py 的变化

重构后 `chat.py` 只需要两行和工具相关的代码：

```python
from app.tools import registry

# 原来：TOOL_SCHEMAS（63 行手写 JSON Schema）
"tools": registry.get_schemas()

# 原来：_execute_tool（21 行 if/else 分发）
output_type, output_value = registry.execute(tool_name, tool_input)
```

---

## 新增工具的流程

重构后新增工具只需两步，不需要修改 `chat.py`：

**第一步**：新建 `tools/xxx.py`

```python
class XxxInput(BaseModel):
    param: str = Field(description="...")

def _execute(input: XxxInput) -> ...:
    ...

XXX_TOOL = ToolDef(
    name="xxx",
    description="...",
    input_model=XxxInput,
    execute=_execute,
    is_read_only=True/False,
)
```

**第二步**：在 `tools/__init__.py` 注册一行

```python
from app.tools.xxx import XXX_TOOL
registry.register(XXX_TOOL)
```

---

## 改造前后对比

| 维度 | 改造前 | 改造后 |
|---|---|---|
| 新增工具 | 改 `chat.py` 两处（schema + if/else） | 新建工具文件 + `__init__.py` 一行注册 |
| 参数验证 | 手动 `.get()`，无类型检查 | Pydantic 自动验证，类型错误有明确报错 |
| Schema 维护 | 手写 JSON Schema，可能和代码不一致 | `model_json_schema()` 自动生成，永远同步 |
| 安全属性 | 无 | `is_read_only` / `is_destructive` 明确声明 |
| 可测试性 | 必须 mock 整个 `chat.py` | 每个工具可以独立单元测试 |
