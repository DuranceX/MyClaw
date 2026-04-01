from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Dict

from app.config import PROJECT_ROOT, get_allowed_origins
from app.models import ChatRequest, ExecCommandRequest, ReadFileRequest, ReadFileResponse
from app.services.chat import stream_chat
from app.services.commands import run_command
from app.services.files import read_repo_file
from app.services.skills import list_skills


app = FastAPI(title="ai-chat-bot-server", version="0.1.0")

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


@app.post("/api/files/read")
def read_file(payload: ReadFileRequest) -> ReadFileResponse:
    """按仓库相对路径读取文本文件内容。

    Args:
        payload: 请求体，包含相对于仓库根目录的 ``file_path``。

    Returns:
        ReadFileResponse: 成功时返回文件内容；失败时返回结构化错误信息，
        例如路径非法或文件读取失败。
    """
    try:
        content = read_repo_file(payload.file_path)
        return ReadFileResponse(success=True, file_path=payload.file_path, content=content)
    except ValueError as exc:
        return ReadFileResponse(success=False, error=str(exc))
    except OSError as exc:
        return ReadFileResponse(success=False, error=f"Read failed: {exc}")


@app.post("/api/commands/exec")
def exec_command(payload: ExecCommandRequest):
    """在仓库根目录执行一条 shell 命令。

    Args:
        payload: 请求体，包含命令字符串以及超时时间（毫秒）。

    Returns:
        ExecCommandResponse: 包含执行是否成功、stdout、stderr 与错误原因。

    Raises:
        HTTPException: 当命令为空字符串时抛出。
    """
    if not payload.command.strip():
        raise HTTPException(status_code=400, detail="Command cannot be empty.")
    return run_command(payload.command, payload.timeout_ms)


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
