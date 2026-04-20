# 配置管理重构报告

## 背景

重构前，项目的配置分散在多个地方：

- LLM 的 `api_key` / `base_url` 硬编码在 `packages/web/.env.local`（`OPENAI_API_KEY`、`XAI_API_KEY` 等）
- 工具类 API Key（`QWEATHER_API_KEY`、`SERPER_API_KEY`、`CLOUD_MAIL_TOKEN`）同样散落在 `.env.local`
- Python 后端通过 `os.getenv()` 直接读取，没有统一的配置模型
- 切换 LLM provider 需要同时修改 `api_key`、`base_url`、`model` 三个地方，容易遗漏

---

## 重构思路

参考 [better-claw](https://github.com/example/better-claw) 项目的配置方案，核心思路是：

> **用一个结构化的配置文件替代散落的环境变量，用 pydantic-settings 做类型校验和加载。**

具体设计决策：

1. **`config.yaml` 放项目根目录**，而不是 `packages/server/` 下，因为它是整个 monorepo 的配置，不属于某个子包
2. **`providers` 字典 + `llm.provider` 选择器**，把所有 provider 的凭证集中定义，切换只需改一个字段
3. **`tools` 块统一管理工具类凭证**，和 LLM 配置平级，职责清晰
4. **`pydantic-settings` 的 `BaseSettings`** 作为配置模型，提供类型校验、IDE 补全、嵌套结构支持

---

## 方案对比

### 方案 A：纯环境变量（重构前）

```
OPENAI_API_KEY=xxx
OPENAI_BASE_URL=xxx
XAI_API_KEY=xxx
XAI_BASE_URL=xxx
```

| 优点 | 缺点 |
|------|------|
| 简单，零依赖 | 切换 provider 需改多个变量 |
| 12-factor app 标准做法 | 没有结构，难以扩展 |
| 容器/CI 友好 | 多 provider 时变量名爆炸 |
| | 无类型校验，拼错变量名无提示 |

### 方案 B：`config.yaml` + `pydantic-settings`（重构后）

```yaml
providers:
  grok:
    api_key: "xai-xxx"
    base_url: "https://api.x.ai/v1"
  bilibili:
    api_key: "bsk-xxx"
    base_url: "http://llmapi.bilibili.co/v1"

llm:
  provider: "grok"
  model: "grok-4.20-beta-latest-reasoning"

tools:
  qweather:
    api_key: "xxx"
    api_host: "mj2k5p7yag.re.qweatherapi.com"
```

| 优点 | 缺点 |
|------|------|
| 切换 provider 只改两行 | 需要额外依赖（pyyaml、pydantic-settings） |
| 结构化，有类型校验 | 不符合 12-factor app 纯环境变量原则 |
| 多 provider 集中管理，不遗漏 | 需要注意 config.yaml 不能提交到 git |
| IDE 可以补全 `settings.llm.api_key` | |
| 工具类凭证和 LLM 配置统一入口 | |

**结论**：对于本地开发、学习项目，方案 B 的开发体验明显更好；生产环境可以通过环境变量覆盖（优先级更高）。

---

## 具体做法

### 1. 依赖

在 `packages/server/pyproject.toml` 新增：

```toml
"pydantic-settings>=2.0.0,<3.0.0",
"pyyaml>=6.0,<7.0",
```

### 2. 配置模型（`packages/server/app/config.py`）

```python
class ProviderConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""

class LlmConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""
    model: str = "grok-4.20-beta-latest-reasoning"
    provider: str = ""

class ToolsConfig(BaseModel):
    qweather: QWeatherConfig = QWeatherConfig()
    serper: SerperConfig = SerperConfig()
    cloud_mail: CloudMailConfig = CloudMailConfig()

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_nested_delimiter="__",   # LLM__API_KEY → settings.llm.api_key
        env_file=[...],
        extra="ignore",
    )
    llm: LlmConfig = Field(default_factory=LlmConfig)
    tools: ToolsConfig = Field(default_factory=ToolsConfig)
    telegram: Optional[TelegramConfig] = None
```

### 3. 加载逻辑

`load_settings()` 的核心流程：

```
读取 config.yaml
  ↓
弹出 providers 字典（不传给 Settings）
  ↓
实例化 Settings（env 变量 > .env 文件 > yaml 剩余字段）
  ↓
根据 llm.provider 名称查找 providers 字典
  ↓
把对应 provider 的 api_key / base_url 填入 settings.llm
  ↓
兜底：如果没有配置 providers，从 OPENAI_* 环境变量读取
```

`providers` 字典单独弹出而不传给 `Settings` 的原因：`BaseSettings` 不认识这个字段（`extra="ignore"` 会丢弃），而且 providers 是"配置的配置"，需要手动处理选择逻辑。

### 4. 工具凭证注入

工具脚本（Node.js / Python / Shell）无法直接读 `config.yaml`，由 `exec_command` 工具在执行子进程前注入环境变量：

```python
def _build_env() -> dict:
    env = os.environ.copy()
    t = settings.tools
    if t.cloud_mail.token:
        env["CLOUD_MAIL_TOKEN"] = t.cloud_mail.token
    # ... 其他工具
    return env

subprocess.run(command, env=_build_env(), ...)
```

这样脚本只需读 `process.env.CLOUD_MAIL_TOKEN`，不需要知道配置来源。

### 5. 文件管理

- `config.yaml`：加入 `.gitignore`，包含真实 key，不提交
- `config.example.yaml`：提交到 git，作为模板，key 填占位符
- `packages/web/.env.local`：清空，只保留注释说明

---

## 遇到的问题及解决方案

### 问题 1：`pydantic-settings` 嵌套字段无法从扁平环境变量映射

**现象**：`XAI_API_KEY` 无法自动映射到 `settings.xai.api_key`。

**原因**：`env_nested_delimiter="__"` 要求格式是 `XAI__API_KEY`（双下划线），而不是 `XAI_API_KEY`（单下划线）。

**解决**：放弃用环境变量名直接映射嵌套字段，改为 `providers` 字典方案——所有 provider 的 key 都在 `config.yaml` 里定义，`load_settings()` 手动查找并填充。

### 问题 2：`config.example.yaml` 意外包含真实 key

**现象**：用户在编辑 `config.example.yaml` 时不小心填入了真实的 bilibili api_key。

**解决**：`config.example.yaml` 已提交到 git，需要手动清理。后续注意：example 文件只放占位符（`bsk-xxx`），真实 key 只放 `config.yaml`。

### 问题 3：模型名称错误导致 500

**现象**：`ppio-messages/claude-4.6-opus` 报错 `no cluster found for model`。

**原因**：bilibili 代理不认识带 `ppio-messages/` 前缀的模型名。

**解决**：改为 `claude-4.6-opus`（去掉前缀）。

### 问题 4：`config.yaml` 路径找不到

**现象**：后端启动后 `settings.llm.api_key` 为空，报 `LLM api_key is not configured`。

**排查**：运行 `python -c "from app.config import _DEFAULT_CONFIG_PATH; print(_DEFAULT_CONFIG_PATH.exists())"` 确认路径是否正确。

**原因**：`PROJECT_ROOT` 的计算路径为 `APP_DIR.parent.parent.parent`（`app/` → `server/` → `packages/` → 项目根），路径正确，实际是 `config.yaml` 文件尚未创建（只有 `config.example.yaml`）。

**解决**：从 `config.example.yaml` 复制为 `config.yaml` 并填入真实 key。

---

## 最终配置优先级

```
系统环境变量
    ↓
packages/server/.env
    ↓
packages/web/.env.local
    ↓
config.yaml（providers 字典手动处理）
    ↓
字段默认值
```

环境变量始终可以覆盖 `config.yaml`，适合 CI/CD 场景注入 key 而不修改文件。
