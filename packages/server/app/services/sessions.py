"""
sessions.py — 会话持久化核心模块
===================================

## 设计背景

原始实现中，消息完全存在内存里，刷新页面后全部丢失。
本模块参考 Claude Code 的 JSONL 文件存储方案，实现会话的持久化读写。

## 存储结构

```
PROJECT_ROOT/
└── .chat-sessions/
    ├── sessions.json          # 索引文件：记录所有会话的元数据
    ├── sess-abc123.jsonl      # 会话消息文件（每行一条消息）
    └── sess-def456.jsonl
```

## 为什么用 JSONL 而不是 JSON 数组？

JSONL（JSON Lines）每行一个独立 JSON 对象，有以下优势：
1. 支持追加写入（append-only），不需要读取整个文件再重写
2. 单行损坏不影响其他行（容错性更好）
3. 大文件可以逐行流式读取，不需要一次性加载到内存
4. Claude Code 也是同样的选择

本项目目前是覆盖写入（每次保存全量消息），但格式上保持了 JSONL 兼容性，
未来如果需要改为追加模式，只需修改 save_session() 的写入逻辑。

## 消息格式

直接使用 AI SDK 的 UIMessage 格式，这样前端 setMessages(loadedMessages) 可以无缝恢复：

```jsonl
{"role": "user", "id": "msg-xxx", "parts": [{"type": "text", "text": "你好"}]}
{"role": "assistant", "id": "msg-yyy", "parts": [{"type": "step-start"}, {"type": "text", "text": "你好！"}]}
{"role": "error", "id": "err-1234567890", "parts": [{"type": "text", "text": "LLM request failed: 400 ..."}]}
```

role: "error" 是对标准格式的扩展，用于持久化错误现场（详见 save_session 注释）。

## 索引文件格式

sessions.json 存储所有会话的元数据，按 updated_at 降序排列：

```json
[
  {
    "id": "sess-abc123",
    "title": "帮我写一个 Python 脚本…",
    "created_at": "2025-01-01T10:00:00+00:00",
    "updated_at": "2025-01-01T10:05:00+00:00"
  }
]
```

标题从第一条用户消息自动提取（前30字），无需 LLM 生成，简单高效。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import PROJECT_ROOT
from app.models import SessionMeta

# ── 存储路径常量 ──────────────────────────────────────────────────────────────
# 会话文件存放在项目根目录的 .chat-sessions/ 下，已加入 .gitignore
# 使用 PROJECT_ROOT 而不是相对路径，确保无论从哪里启动服务都能找到正确位置
SESSIONS_DIR = PROJECT_ROOT / ".chat-sessions"
INDEX_FILE = SESSIONS_DIR / "sessions.json"


# ── 内部工具函数 ──────────────────────────────────────────────────────────────

def _ensure_dir() -> None:
    """确保存储目录存在。

    main.py 启动时会调用一次，但 save_session 也会调用，
    防止目录被意外删除后写入失败。
    """
    SESSIONS_DIR.mkdir(exist_ok=True)


def _session_file(session_id: str) -> Path:
    """根据 session_id 返回对应的 JSONL 文件路径。

    文件名格式：sess-abc123.jsonl
    session_id 由前端生成（crypto.randomUUID() 截取12位），格式固定，不需要校验。
    """
    return SESSIONS_DIR / f"{session_id}.jsonl"


def _now_iso() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串，带时区信息。

    示例：2025-01-01T10:00:00+00:00
    带时区信息是为了前端 formatTime() 能正确计算时间差。
    """
    return datetime.now(timezone.utc).isoformat()


# ── 索引文件读写 ──────────────────────────────────────────────────────────────
# 索引文件是一个 JSON 数组，记录所有会话的元数据。
# 之所以用单独的索引文件而不是扫描目录，是因为：
# 1. 获取会话列表时不需要读取每个 JSONL 文件（性能更好）
# 2. 可以存储 title、created_at 等元数据，而不需要解析消息内容
# 3. 与 Claude Code 的设计一致

def _read_index() -> List[Dict[str, Any]]:
    """读取索引文件，返回会话元数据列表。

    文件不存在或解析失败时返回空列表，而不是抛出异常。
    这样即使索引文件损坏，也不会导致整个服务崩溃。
    """
    if not INDEX_FILE.exists():
        return []
    try:
        return json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # 文件损坏或读取失败时，返回空列表（降级处理）
        # 已有的 JSONL 文件不受影响，只是列表显示为空
        return []


def _write_index(entries: List[Dict[str, Any]]) -> None:
    """将会话元数据列表写入索引文件。

    使用 ensure_ascii=False 保留中文字符，indent=2 便于人工查看。
    注意：这里没有原子写入（先写临时文件再重命名），
    对于单用户本地应用来说足够了，并发场景下可能需要加锁。
    """
    INDEX_FILE.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── 公共接口 ──────────────────────────────────────────────────────────────────

def list_sessions() -> List[SessionMeta]:
    """返回所有会话元数据，按 updated_at 降序排列（最近更新的在前）。

    前端侧边栏展示时直接使用这个顺序，最近的会话排在最上面。
    页面加载时自动恢复的也是列表第一条（updated_at 最新的会话）。
    """
    entries = _read_index()
    # 按 updated_at 降序排列，字符串比较对 ISO 8601 格式有效
    entries.sort(key=lambda e: e.get("updated_at", ""), reverse=True)
    return [SessionMeta(**e) for e in entries]


def get_session(session_id: str) -> Optional[List[Dict[str, Any]]]:
    """读取指定会话的消息列表，不存在时返回 None。

    返回的消息格式与 AI SDK UIMessage 完全一致，
    前端可以直接 setMessages(data.messages) 恢复状态，不需要任何转换。

    JSONL 解析策略：
    - 逐行解析，跳过空行和损坏的行
    - 单行损坏不影响其他消息（JSONL 格式的容错优势）
    """
    path = _session_file(session_id)
    if not path.exists():
        return None
    messages = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                # 跳过损坏的行，继续解析其他行
                pass
    return messages


def save_session(session_id: str, messages: List[Dict[str, Any]]) -> None:
    """覆盖写入会话消息，并更新索引文件中的元数据。

    ## 为什么是覆盖写入而不是追加？

    前端每次保存的是 useChat 的完整 messages 数组（包含所有历史消息）。
    如果用追加模式，每次保存都会重复写入之前的消息。
    覆盖写入虽然每次都重写整个文件，但实现最简单，且消息数量通常不大。

    ## 为什么由前端主动保存，而不是后端流结束时保存？

    后端的 stream_chat 只拿到请求时的 payload.messages（不含本轮 AI 回复）。
    AI 的回复是通过 SSE 流逐步发给前端的，后端没有完整的最终消息列表。
    让前端在流结束后主动 PUT 是最简单的方案，不需要后端重建 AI 消息。

    ## 关于 role: "error" 消息

    前端在出错时会追加一条 role: "error" 的消息再保存。
    这是对 AI SDK UIMessage 格式的扩展，用于持久化错误现场。
    加载历史时这条消息会按顺序出现在正确位置，前端单独渲染为红色错误卡片。

    Args:
        session_id: 会话 ID（由前端生成，格式 sess-xxxxxxxx）
        messages: 完整的消息列表（AI SDK UIMessage 格式）
    """
    _ensure_dir()

    # 写 JSONL：每条消息序列化为一行
    # ensure_ascii=False 保留中文字符
    path = _session_file(session_id)
    lines = [json.dumps(msg, ensure_ascii=False) for msg in messages]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # 从第一条用户消息提取标题，用于侧边栏展示
    title = _extract_title(messages)
    now = _now_iso()

    # 更新索引：如果已存在则更新 title 和 updated_at，否则新建条目
    # created_at 只在首次创建时设置，之后不再更新
    entries = _read_index()
    existing = next((e for e in entries if e["id"] == session_id), None)
    if existing:
        existing["title"] = title
        existing["updated_at"] = now
    else:
        entries.append({
            "id": session_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
        })
    _write_index(entries)


def delete_session(session_id: str) -> bool:
    """删除会话文件和索引条目，返回是否成功找到并删除。

    删除逻辑：
    1. 删除 JSONL 文件（如果存在）
    2. 从索引中移除对应条目

    两步都做是为了保持一致性：
    - 如果只有 JSONL 文件没有索引条目（数据不一致），也能清理干净
    - 如果只有索引条目没有 JSONL 文件（文件被手动删除），也能从索引中移除

    Returns:
        True 表示找到并删除了（文件或索引条目至少有一个存在）
        False 表示什么都没找到（会话不存在）
    """
    path = _session_file(session_id)
    found = path.exists()
    if found:
        path.unlink()

    entries = _read_index()
    new_entries = [e for e in entries if e["id"] != session_id]
    if len(new_entries) != len(entries):
        # 索引中有这个条目，更新索引
        _write_index(new_entries)
        found = True

    return found


def new_session_id() -> str:
    """生成新的会话 ID。

    格式：sess-{12位十六进制}，例如 sess-a1b2c3d4e5f6

    注意：实际上 session_id 由前端生成（crypto.randomUUID() 截取12位），
    这个函数主要供后端测试或未来需要后端生成 ID 的场景使用。
    前端和后端使用相同的格式，保持一致性。
    """
    return f"sess-{uuid.uuid4().hex[:12]}"


# ── 内部工具 ──────────────────────────────────────────────────────────────────

def _extract_title(messages: List[Dict[str, Any]], max_len: int = 30) -> str:
    """从消息列表中提取会话标题。

    策略：取第一条 role="user" 消息中第一个 type="text" part 的文本，
    截取前 max_len 个字符，超出时追加省略号。

    为什么不用 LLM 生成标题？
    - 简单快速，不需要额外的 API 调用
    - 第一条用户消息通常就能代表会话主题
    - Claude Code 也是类似的做法（取消息摘要）

    Args:
        messages: 消息列表（AI SDK UIMessage 格式）
        max_len: 标题最大字符数，默认30

    Returns:
        提取到的标题，如果没有用户消息则返回 "新会话"
    """
    for msg in messages:
        if msg.get("role") != "user":
            continue
        for part in msg.get("parts", []):
            if part.get("type") == "text":
                text = str(part.get("text", "")).strip()
                if text:
                    return text[:max_len] + ("…" if len(text) > max_len else "")
    return "新会话"
