from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, Optional

from app.config import PROJECT_ROOT, get_allowed_origins, load_settings, _DEFAULT_CONFIG_PATH
from app.models import ChatRequest
from app.routers.sessions import router as sessions_router
from app.services.chat import stream_chat, usage_stats
from app.services.sessions import SESSIONS_DIR
from app.services.skills import list_skills

import yaml


app = FastAPI(title="ai-chat-bot-server", version="0.1.0")

# 确保会话存储目录存在
SESSIONS_DIR.mkdir(exist_ok=True)

app.include_router(sessions_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, str]:
    """返回服务健康状态，便于本地开发时快速确认后端是否正常启动。

    Returns:
        dict[str, str]: 包含服务状态以及后端当前识别到的项目根目录。
    """
    return {"status": "ok", "project_root": PROJECT_ROOT.as_posix()}


@app.get("/api/skills")
def get_skills():
    """返回仓库根目录 ``skills/`` 下扫描到的全部技能索引。"""
    return {"data": [entry.model_dump() for entry in list_skills()]}


@app.get("/api/models")
def get_models(provider: Optional[str] = None):
    """返回 config.yaml 中配置的 provider 列表，或指定 provider 下的模型列表。

    - GET /api/models          → 返回所有 provider 名称及其 base_url
    - GET /api/models?provider=grok → 返回该 provider 下已知的模型（从 base_url 探测或静态列表）
    """
    raw = yaml.safe_load(_DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")) if _DEFAULT_CONFIG_PATH.exists() else {}
    providers: Dict[str, dict] = raw.get("providers", {})

    if provider is None:
        # 返回所有 provider，标注当前激活的
        from app.config import settings as _settings
        result = []
        for name, cfg in providers.items():
            result.append({
                "name": name,
                "base_url": cfg.get("base_url", ""),
                "active": name == _settings.llm.provider,
            })
        return {"data": result}

    # 返回指定 provider 下的模型列表（调用 /models 端点）
    if provider not in providers:
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' not found in config.yaml")

    cfg = providers[provider]
    api_key = cfg.get("api_key", "")
    base_url = cfg.get("base_url", "").rstrip("/")
    proxy = cfg.get("proxy") or None

    try:
        import httpx as _httpx
        timeout = _httpx.Timeout(connect=10, read=15, write=10, pool=5)
        with _httpx.Client(proxy=proxy, timeout=timeout) as client:
            resp = client.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("id") for m in data.get("data", []) if m.get("id")]
            return {"provider": provider, "data": models}
        # /models 端点不可用，回退到 config.yaml 里的静态列表
        static = cfg.get("models") or []
        if static:
            return {"provider": provider, "data": static}
        return {"provider": provider, "data": [], "error": f"HTTP {resp.status_code}，且未配置静态模型列表"}
    except Exception as exc:
        # 网络异常也回退到静态列表
        static = cfg.get("models") or []
        if static:
            return {"provider": provider, "data": static}
        return {"provider": provider, "data": [], "error": str(exc)}


class SwitchModelRequest(BaseModel):
    provider: str
    model: str


@app.post("/api/model")
def switch_model(body: SwitchModelRequest):
    """切换当前使用的 provider 和 model，写回 config.yaml 并热重载 settings。"""
    raw = yaml.safe_load(_DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")) if _DEFAULT_CONFIG_PATH.exists() else {}
    providers: Dict[str, dict] = raw.get("providers", {})

    if body.provider not in providers:
        raise HTTPException(status_code=404, detail=f"Provider '{body.provider}' not found in config.yaml")

    # 更新 config.yaml
    if "llm" not in raw:
        raw["llm"] = {}
    raw["llm"]["provider"] = body.provider
    raw["llm"]["model"] = body.model

    with _DEFAULT_CONFIG_PATH.open("w", encoding="utf-8") as f:
        yaml.dump(raw, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    # 热重载 settings 单例
    import app.config as _cfg_module
    new_settings = load_settings(_DEFAULT_CONFIG_PATH)
    _cfg_module.settings.llm.provider = new_settings.llm.provider
    _cfg_module.settings.llm.model = new_settings.llm.model
    _cfg_module.settings.llm.api_key = new_settings.llm.api_key
    _cfg_module.settings.llm.base_url = new_settings.llm.base_url
    _cfg_module.settings.llm.proxy = new_settings.llm.proxy

    return {"provider": body.provider, "model": body.model}


@app.get("/api/usage")
def get_usage():
    """返回本次进程启动以来的累计 token 用量与请求次数。"""
    from app.config import settings as _settings
    return {
        **usage_stats.to_dict(),
        "current_provider": _settings.llm.provider,
        "current_model": _settings.llm.model,
    }


# 支持余额查询的 provider 及其端点
_BALANCE_ENDPOINTS: Dict[str, str] = {
    "deepseek": "https://api.deepseek.com/user/balance",
}


@app.get("/api/balance")
def get_balance():
    """查询当前 provider 的账户余额（如果支持）。"""
    from app.config import settings as _settings
    import httpx as _httpx

    provider = _settings.llm.provider
    endpoint = _BALANCE_ENDPOINTS.get(provider)
    if not endpoint:
        raise HTTPException(status_code=404, detail=f"Provider '{provider}' 暂无可用的余额查询接口")

    try:
        api_key = _settings.llm.api_key
        proxy = _settings.llm.proxy or None
        with _httpx.Client(proxy=proxy, timeout=10) as client:
            resp = client.get(endpoint, headers={"Authorization": f"Bearer {api_key}"})
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"余额接口返回 HTTP {resp.status_code}")
        return {"provider": provider, "data": resp.json()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/chat")
def chat(payload: ChatRequest):
    """通过 Python 后端统一处理 LLM 调用、工具执行和流式消息输出。"""
    # 保持与 AI SDK 路由一致的响应头，这样 `useChat()` 还能按原来的方式消费这个接口。
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
