from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


# ── 路径常量 ──────────────────────────────────────────────────────────────────

APP_DIR = Path(__file__).resolve().parent
SERVER_DIR = APP_DIR.parent
PROJECT_ROOT = SERVER_DIR.parent.parent
SKILLS_DIR = PROJECT_ROOT / ".skills"

_DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"
_DEFAULT_WEB_ENV_PATH = PROJECT_ROOT / "packages" / "web" / ".env.local"
_DEFAULT_SERVER_ENV_PATH = SERVER_DIR / ".env"


# ── Sub-models ────────────────────────────────────────────────────────────────

class ProviderConfig(BaseModel):
    """单个 provider 的连接信息。"""
    api_key: str = ""
    base_url: str = ""


class LlmConfig(BaseModel):
    """运行时生效的 LLM 配置，由 load_settings 根据 provider 选择填充。"""
    api_key: str = ""
    base_url: str = ""
    model: str = "grok-4.20-beta-latest-reasoning"
    provider: str = ""  # 当前选中的 provider 名称
    proxy: Optional[str] = None  # 仅用于模型调用，例如 "http://127.0.0.1:7890"


class TelegramConfig(BaseModel):
    """Telegram 适配器配置（预留，接入时填充）。"""
    bot_token: str = ""
    proxy: Optional[str] = None
    command_prefix: str = "/"


class QWeatherConfig(BaseModel):
    api_key: str = ""
    api_host: str = ""


class SerperConfig(BaseModel):
    api_key: str = ""


class CloudMailConfig(BaseModel):
    token: str = ""


class ToolsConfig(BaseModel):
    """各工具所需的第三方 API 凭证。"""
    qweather: QWeatherConfig = QWeatherConfig()
    serper: SerperConfig = SerperConfig()
    cloud_mail: CloudMailConfig = CloudMailConfig()


# ── 主 Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    """应用配置。

    加载优先级（高 → 低）：
      1. 环境变量
      2. packages/server/.env
      3. packages/web/.env.local
      4. config.yaml（项目根目录）
      5. 字段默认值
    """

    model_config = SettingsConfigDict(
        env_nested_delimiter="__",
        env_file=[str(_DEFAULT_WEB_ENV_PATH), str(_DEFAULT_SERVER_ENV_PATH)],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Web 跨域
    web_origin: str = "http://127.0.0.1:3000"

    # 运行时 LLM 配置（由 load_settings 填充，不直接从 env 读）
    llm: LlmConfig = Field(default_factory=LlmConfig)

    # 工具类 API 凭证
    tools: ToolsConfig = Field(default_factory=ToolsConfig)

    # Telegram（预留）
    telegram: Optional[TelegramConfig] = None


def _load_yaml_defaults(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_settings(config_path: Path = _DEFAULT_CONFIG_PATH) -> Settings:
    """加载配置。

    yaml 中的 providers 字典 + llm.provider 字段决定最终使用哪个 provider。
    env 文件里的 OPENAI_API_KEY / OPENAI_BASE_URL 作为兜底，
    在 yaml 没有配置 providers 时生效。
    """
    raw = _load_yaml_defaults(config_path)

    providers: Dict[str, Any] = raw.pop("providers", {})
    llm_raw: Dict[str, Any] = raw.get("llm", {})
    provider_name: str = llm_raw.get("provider", "")

    settings = Settings(**raw)

    # 用 provider 名称查找对应的 api_key / base_url
    if provider_name and provider_name in providers:
        p = ProviderConfig(**providers[provider_name])
        settings.llm.provider = provider_name
        if p.api_key:
            settings.llm.api_key = p.api_key
        if p.base_url:
            settings.llm.base_url = p.base_url
    elif not settings.llm.api_key:
        # 兜底：从 env 里读 OPENAI_*（兼容旧配置）
        import os
        settings.llm.api_key = os.getenv("OPENAI_API_KEY", "")
        settings.llm.base_url = os.getenv("OPENAI_BASE_URL", "")

    return settings


# 模块级单例，启动时初始化一次
settings = load_settings()


# ── 兼容旧代码的常量 ──────────────────────────────────────────────────────────

def get_allowed_origins() -> List[str]:
    return [o.strip() for o in settings.web_origin.split(",") if o.strip()]
