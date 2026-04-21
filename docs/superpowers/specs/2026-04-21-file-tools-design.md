# 文件工具扩展设计文档

日期：2026-04-21

## 背景

当前项目工具集只有 `read_file` 和 `exec_command`，agent 无法精确修改文件，也无法高效搜索代码库。本次新增四个工具：Edit、Write、Grep、Glob，并引入共享路径守卫支持可配置的访问范围。

## 目标

- 让 agent 具备文件读写、精确编辑、内容搜索、路径匹配能力
- 所有文件操作统一经过路径守卫，防止目录穿越，支持范围限制
- 访问范围可通过 `config.yaml` 配置，默认为整个项目根目录

## 架构

### 新增文件

| 文件 | 职责 |
|------|------|
| `app/tools/path_guard.py` | 共享路径解析与校验 |
| `app/tools/grep.py` | 内容搜索工具 |
| `app/tools/glob.py` | 文件路径匹配工具 |
| `app/tools/edit_file.py` | 精确字符串替换工具 |
| `app/tools/write_file.py` | 创建/覆盖文件工具 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `app/config.py` | `ToolsConfig` 新增 `file_access_root: str = ""` |
| `app/tools/read_file.py` | 改用 `path_guard.resolve_path()`，删除自有 `_resolve_path` |
| `app/tools/__init__.py` | 注册四个新工具 |
| `config.yaml` | 补充 `file_access_root` 注释说明 |

## 路径守卫（`path_guard.py`）

```python
def resolve_path(relative_path: str) -> Path:
    """
    把相对路径解析为绝对路径，校验在 allowed_root 内。

    allowed_root 来源：settings.tools.file_access_root
      - 空字符串 → PROJECT_ROOT（整个项目）
      - 相对路径如 ".skills" → PROJECT_ROOT / ".skills"

    抛出 ValueError 如果路径穿越 allowed_root。
    """
```

所有涉及路径的工具（read_file、edit_file、write_file、grep、glob）统一调此函数。

## 工具详细设计

### Grep

**参数：**
```
pattern: str              # 正则表达式（必填）
path: str = ""            # 搜索目录，相对路径，空=allowed_root
glob: str = ""            # 文件过滤，如 "*.py"
output_mode: str = "files_with_matches"  # content | files_with_matches | count
context_lines: int = 0    # 上下文行数（-C N）
```

**实现：**
- 优先调用系统 `grep -rn` 命令（通过 subprocess）
- 若系统无 grep（Windows），降级为 pathlib 纯 Python 遍历
- 结果截断至 200 行，防止 token 爆炸

**返回：**
```json
{ "matches": ["path:line:content", ...], "truncated": false }
```

### Glob

**参数：**
```
pattern: str   # glob 模式，如 "**/*.py"（必填）
path: str = "" # 搜索目录，相对路径，空=allowed_root
```

**实现：**
- 使用 `pathlib.Path.glob()`
- 自动排除 `.git/`、`node_modules/`、`.venv/`、`__pycache__/`
- 结果按修改时间降序排序，最多返回 100 条

**返回：**
```json
{ "files": ["rel/path/to/file", ...], "truncated": false }
```

### Edit

**参数：**
```
file_path: str        # 相对路径（必填）
old_string: str       # 要替换的文本，必须在文件中唯一匹配（必填）
new_string: str       # 替换后的文本（必填）
replace_all: bool = false  # 是否替换所有匹配
```

**实现：**
- 读取文件，统计 `old_string` 出现次数
- `replace_all=false` 且出现次数 > 1：报错，提示模型提供更多上下文
- `replace_all=false` 且出现次数 = 0：报错
- 替换后写回文件

**返回：**
```json
{ "success": true, "replacements": 1 }
```

### Write

**参数：**
```
file_path: str  # 相对路径（必填）
content: str    # 完整文件内容（必填）
```

**实现：**
- 自动创建父目录（`mkdir -p` 语义）
- 文件已存在时直接覆盖

**返回：**
```json
{ "success": true, "file_path": "rel/path" }
```

## 配置

`config.yaml` 新增（在 `tools:` 下）：

```yaml
tools:
  file_access_root: ""  # 空=整个项目根目录，可改为 ".skills" 限制范围
```

`app/config.py` 的 `ToolsConfig`：

```python
class ToolsConfig(BaseModel):
    file_access_root: str = ""  # 新增
    qweather: QWeatherConfig = QWeatherConfig()
    # ...
```

## 安全

- 所有路径操作经 `path_guard.resolve_path()` 校验，防止 `../../` 穿越
- `file_access_root` 限制写操作范围（读操作同样受限）
- `is_read_only` / `is_destructive` 字段已在 `ToolDef` 中声明，待后续权限系统实现时启用（TODO）

## 不在本次范围内

- `is_read_only` / `is_destructive` 的运行时权限拦截
- 文件操作的 diff 展示（UI 层）
- 二进制文件支持
