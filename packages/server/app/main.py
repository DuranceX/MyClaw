from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Dict

from app.config import PROJECT_ROOT, get_allowed_origins
from app.models import ChatRequest
from app.routers.sessions import router as sessions_router
from app.services.chat import stream_chat
from app.services.sessions import SESSIONS_DIR
from app.services.skills import list_skills


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
    """返回仓库根目录 ``skills/`` 下扫描到的全部技能索引。

    Returns:
        dict: 一个带 ``data`` 字段的 JSON 对象，内部是序列化后的技能列表。
    """
    return {"data": [entry.model_dump() for entry in list_skills()]}


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
