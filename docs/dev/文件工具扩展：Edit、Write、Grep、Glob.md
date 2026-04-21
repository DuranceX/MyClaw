# 文件工具扩展：Edit、Write、Grep、Glob

在工具系统重构（buildTool 模式）的基础上，新增四个文件操作工具，并引入共享路径守卫，让 agent 具备精确编辑文件、全量写入、内容搜索和路径匹配的能力。

当前相关代码位于：

- `packages/server/app/tools/path_guard.py` — 共享路径解析与校验
- `packages/server/app/tools/edit_file.py` — 精确字符串替换工具
- `packages/server/app/tools/write_file.py` — 创建/覆盖文件工具
- `packages/server/app/tools/grep.py` — 内容搜索工具
- `packages/server/app/tools/glob.py` — 文件路径匹配工具
- `packages/server/app/tools/read_file.py` — 已迁移至共享路径守卫
- `packages/server/app/config.py` — `ToolsConfig` 新增 `file_access_root`

---

## 背景与动机

原有工具集只有 `read_file` 和 `exec_command`。`exec_command` 虽然可以通过 `grep`/`find`/`sed` 等 shell 命令间接实现文件操作，但存在几个问题：

- **不安全**：shell 命令没有路径边界限制，agent 可以操作任意文件
- **不可控**：`sed -i` 这类命令出错时没有明确的错误信息，LLM 难以自我纠正
- **不精确**：LLM 生成 shell 命令容易出现转义错误、路径问题

专用工具的参数经过 Pydantic 验证，错误信息结构化，LLM 更容易理解并重试。

## 设计思路

### 路径守卫（path_guard.py）

所有文件工具的路径操作都经过同一个 `resolve_path()` 函数，集中处理两件事：

1. 把相对路径解析为绝对路径（基于 `PROJECT_ROOT`）
2. 校验解析后的路径在 `allowed_root` 内，防止 `../../` 目录穿越

`allowed_root` 来自 `config.yaml` 的 `tools.file_access_root`：
- 空字符串 → 整个项目根目录（默认）
- 设为 `.skills` → agent 只能操作技能文件

原来 `read_file.py` 有自己的私有 `_resolve_path`，这次一并迁移到 `path_guard`，消除重复。

### Edit vs Write 的分工

参考 Claude Code 的 FileEditTool / FileWriteTool 设计：

- **edit_file**：精确字符串替换，适合修改函数体、新增函数（把末尾的 `}` 当 old_string）、改配置项等局部修改
- **write_file**：全量覆盖，适合创建新文件或大幅重写整个文件

edit_file 的核心约束：`old_string` 在 `replace_all=false` 时必须唯一匹配。不唯一时报错并提示 LLM 加入更多上下文（如前后几行）使其唯一，而不是静默替换错误位置。

### Grep 的降级策略

优先调用系统 `grep -rn`（通过 subprocess），不可用时（如 Windows）降级为 pathlib 纯 Python 遍历。结果截断至 200 行防止 token 爆炸。

支持三种输出模式：
- `files_with_matches`（默认）：只返回文件路径，适合定位文件
- `content`：返回匹配行内容，适合查看具体代码
- `count`：返回每个文件的匹配数量

## 方案对比

### 方案 A：直接用 exec_command 执行 grep/sed

不需要新增工具，LLM 自己拼 shell 命令。

缺点：无路径边界、命令转义容易出错、错误信息不结构化。

### 方案 B：专用工具 + 共享路径守卫（最终选择）

每个操作对应一个工具，参数经 Pydantic 验证，路径统一经守卫校验。

优点：安全、错误信息清晰、LLM 更容易自我纠正。

**最终选择**：方案 B。专用工具的结构化错误信息对 LLM 的自我纠正能力影响显著，而实现成本并不高。

## 具体改动

### path_guard.py（新增）

核心逻辑：

```python
def resolve_path(relative_path: str) -> Path:
    allowed_root = _get_allowed_root()  # 从 settings 读取
    resolved = (allowed_root / relative_path).resolve()
    if not str(resolved).startswith(str(allowed_root)):
        raise ValueError(f"路径 {relative_path!r} 超出允许范围 {allowed_root}")
    return resolved
```

### edit_file.py（新增）

唯一性校验是关键：

```python
count = content.count(input.old_string)
if count == 0:
    return EditFileOutput(success=False, error="old_string 在文件中未找到匹配...")
if not input.replace_all and count > 1:
    return EditFileOutput(success=False, error=f"old_string 有 {count} 处匹配，请加入更多上下文使其唯一...")
```

### grep.py（新增）

降级策略：

```python
try:
    # 优先系统 grep
    result = subprocess.run(["grep", "-rn", ...], ...)
except FileNotFoundError:
    # 降级 pathlib
    matches = _grep_python(pattern, search_path, ...)
```

### config.py（修改）

`ToolsConfig` 新增字段：

```python
class ToolsConfig(BaseModel):
    file_access_root: str = ""  # 空=整个项目，可改为 ".skills" 限制范围
    ...
```

## 遗留 TODO

`ToolDef` 上的 `is_read_only` 和 `is_destructive` 字段目前只是声明，`ToolRegistry.execute()` 尚未读取它们做运行时拦截。`write_file` 和 `edit_file` 已标记 `is_destructive=True`，待后续权限系统实现时可在执行前触发用户确认。
