"""
routers/sessions.py — 会话管理 REST API
=========================================

## 职责

提供会话的增删查改接口，供前端（Next.js）通过 HTTP 调用。
实际的文件读写逻辑在 services/sessions.py 中，这里只负责路由和参数校验。

## API 设计

遵循 RESTful 风格：

| 方法   | 路径                    | 功能                         |
|--------|-------------------------|------------------------------|
| GET    | /api/sessions           | 返回会话列表（按时间降序）   |
| GET    | /api/sessions/{id}      | 返回指定会话的消息列表       |
| PUT    | /api/sessions/{id}      | 保存/覆盖会话消息            |
| DELETE | /api/sessions/{id}      | 删除会话                     |

## 为什么用 PUT 而不是 POST 保存？

PUT 语义是"幂等地创建或替换资源"，与我们的覆盖写入语义完全一致：
- 第一次保存：创建新会话文件
- 后续保存：覆盖已有文件
POST 通常用于"追加创建"，语义上不太准确。

## 注册方式

在 main.py 中通过 app.include_router(sessions_router) 注册，
router 带有 prefix="/api/sessions"，所以这里的路径是相对路径。
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import SessionMessagesResponse, SessionMeta
from app.services.sessions import delete_session, get_session, list_sessions, save_session

# prefix 统一加在这里，main.py 注册时不需要再指定前缀
# tags 用于 FastAPI 自动生成的 /docs 页面分组
router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# ── 请求体模型 ────────────────────────────────────────────────────────────────

class SaveSessionRequest(BaseModel):
    """PUT /api/sessions/{id} 的请求体。

    messages 是完整的消息列表（AI SDK UIMessage 格式），
    前端每次保存时传入 useChat 的全量 messages 数组。

    为什么不在 models.py 里定义？
    这个模型只在这个路由文件里用，放在这里更内聚，
    避免 models.py 变成一个什么都往里塞的大杂烩。
    """
    messages: List[Dict[str, Any]]


# ── 路由处理函数 ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[SessionMeta])
def get_sessions():
    """GET /api/sessions — 返回所有会话元数据列表。

    列表按 updated_at 降序排列（最近更新的在前），
    前端侧边栏直接使用这个顺序展示，页面加载时自动恢复第一条（最新的）会话。

    response_model=List[SessionMeta] 让 FastAPI 自动做序列化和文档生成。
    """
    return list_sessions()


@router.get("/{session_id}", response_model=SessionMessagesResponse)
def get_session_messages(session_id: str):
    """GET /api/sessions/{id} — 返回指定会话的消息列表。

    前端切换会话时调用，拿到消息后直接 setMessages(data.messages) 恢复状态。

    会话不存在时返回 404，前端会静默处理（catch(() => {})），
    不会显示错误提示，因为这通常是正常情况（新会话还没保存过）。
    """
    messages = get_session(session_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionMessagesResponse(session_id=session_id, messages=messages)


@router.put("/{session_id}")
def save_session_messages(session_id: str, payload: SaveSessionRequest):
    """PUT /api/sessions/{id} — 保存（覆盖写入）会话消息。

    触发时机：前端检测到 useChat 的 status 从 streaming/submitted 变为 ready/error 时。
    也就是每次 AI 回复完成（或出错）后自动保存一次。

    payload.messages 是完整的消息列表，包含：
    - 所有历史用户消息
    - 所有历史 AI 回复
    - 如果出错，还包含一条 role: "error" 的错误消息（前端追加的）

    返回 {"ok": True} 而不是 204 No Content，
    是因为前端 fetch 后不检查响应体，返回什么都无所谓，
    但有个明确的响应体比空响应更容易调试。
    """
    save_session(session_id, payload.messages)
    return {"ok": True}


@router.delete("/{session_id}")
def remove_session(session_id: str):
    """DELETE /api/sessions/{id} — 删除会话。

    同时删除 JSONL 文件和索引条目，保持数据一致性。
    会话不存在时返回 404。

    前端删除后会：
    1. 触发侧边栏刷新（sidebarRefresh++）
    2. 如果删除的是当前会话，自动新建一个空会话（handleNew()）
    """
    found = delete_session(session_id)
    if not found:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}
