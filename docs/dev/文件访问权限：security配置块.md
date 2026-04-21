# 文件访问权限：security 配置块

在路径守卫的基础上，将文件访问权限配置从 `tools.file_access_root` 独立为 `security` 配置块，支持绝对路径和排除列表，让 agent 的文件访问范围可以精确控制。

当前相关代码位于：

- `packages/server/app/config.py` — `SecurityConfig` 模型定义
- `packages/server/app/tools/path_guard.py` — 读取 `security` 配置并执行校验
- `config.example.yaml` — 配置示例与注释

---

## 背景与动机

上一版路径守卫的 `file_access_root` 放在 `tools` 配置块下，且只支持相对于 `PROJECT_ROOT` 的相对路径。这带来两个限制：

1. **无法访问项目外的文件**：用户说"看一下 `~/Code/Work/videoup/package.json`"，模型只能用 `exec_command cat`，因为 `read_file` 的路径校验会拒绝项目外的绝对路径。
2. **无法细粒度排除**：扩大了根目录后，没有办法把某些敏感子目录排除在外。

## 设计思路

### 配置结构

将权限配置从 `tools` 中独立出来，放到顶层的 `security` 块：

```yaml
security:
  file_access_root: "~/Code"   # 允许访问的根目录（绝对路径）
  exclude_files:
    - "Work"                   # 排除 ~/Code/Work 目录
    - "secret.txt"             # 排除 ~/Code/secret.txt
```

`file_access_root` 改为支持绝对路径（含 `~` 展开），不填则默认 `PROJECT_ROOT`。

### 路径解析规则

`resolve_path()` 的行为：

- **相对路径**（如 `packages/web/package.json`）→ 以 `PROJECT_ROOT` 为基准拼接，再以 `allowed_root` 做权限校验
- **绝对路径**（如 `~/Code/Work/videoup/package.json`）→ 直接 resolve，以 `allowed_root` 做权限校验

这样用户说项目内的文件用相对路径，说项目外的文件用绝对路径，两种场景都能走 `read_file` 而不是 `exec_command cat`。

### exclude_files 的匹配逻辑

排除列表中的每条路径：
- 绝对路径 → 直接使用
- 相对路径 → 相对于 `allowed_root` 拼接
- 末尾有没有 `/` 均可（统一 `rstrip("/")`）

判断时用 `path.relative_to(excluded)` 检查 path 是否在某个排除目录下，命中则拒绝访问。

## 具体改动

### config.py

新增 `SecurityConfig`，从 `ToolsConfig` 中移除 `file_access_root`，在 `Settings` 中加入 `security` 字段：

```python
class SecurityConfig(BaseModel):
    file_access_root: str = ""
    exclude_files: List[str] = Field(default_factory=list)

class Settings(BaseSettings):
    security: SecurityConfig = Field(default_factory=SecurityConfig)
    tools: ToolsConfig = ...
```

### path_guard.py

`get_allowed_root()` 改为读 `settings.security.file_access_root`，新增 `_get_exclude_paths()` 和 `_is_excluded()` 两个内部函数，在 `resolve_path()` 末尾加排除校验。

错误信息对用户友好，明确告知如何修改配置解除限制：

```
路径 '...' 超出允许范围 '...'。
如需访问该路径，请在 config.yaml 的 security.file_access_root 中配置更大的根目录。
```

### read_file.py

更新工具描述，明确告知模型"项目外的文件用绝对路径"，引导模型优先使用 `read_file` 而非 `exec_command cat`。

---

## exec_command 的安全边界

`exec_command` 执行任意 shell 命令，天然绕过 `path_guard`。例如 `cat /etc/passwd` 不经过任何路径校验就能执行。

### 为什么不拦截？

参考 Claude Code 的做法：它用 tree-sitter 解析 AST，识别 `cat`、`head`、`tail` 等几十个路径命令，提取文件参数后做 `pathInAllowedWorkingPath` 校验。但这套方案的维护成本极高——管道、变量替换、进程替换、Zsh 特有语法都需要单独处理，且 `shell=True` 下几乎不可能做到完备。

Claude Code 的最终策略也不是"硬拦截"，而是"**路径在工作目录外 → 弹框让用户确认**"。本项目是纯 API 服务，没有交互式确认机制，所以选择了更务实的方案：

- `exec_command` 定位为"运行脚本/构建命令"的逃生舱，description 明确引导模型不要用它读文件
- 真正的安全边界由 `path_guard` 在文件工具层面保证（`read_file`、`grep`、`glob`、`edit_file`、`write_file`）
- 需要严格隔离时，收窄 `security.file_access_root` + `exclude_files`，并在部署层面限制进程权限
