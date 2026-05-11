from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Iterator, List

import httpx

from app.config import settings
from app.models import ChatRequest, SkillEntry
from app.services.skills import list_skills
from app.tools import registry


MAX_STEPS = 50


# ── 全局 usage 统计 ───────────────────────────────────────────────────────────

@dataclass
class UsageStats:
    """累计 token 用量与请求次数，进程生命周期内持续累加。"""
    total_requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def record(self, usage: Dict[str, Any]) -> None:
        self.total_requests += 1
        self.prompt_tokens += usage.get("prompt_tokens", 0)
        self.completion_tokens += usage.get("completion_tokens", 0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_requests": self.total_requests,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


usage_stats = UsageStats()

# 工具 schema 和执行逻辑已迁移到 app/tools/ 目录，由 registry 统一管理。
# 参考 Claude Code 的 buildTool 模式：每个工具是独立的自描述对象，
# 注册表负责收集，调用方只和注册表打交道。


def construct_system_prompt(skills: List[SkillEntry]) -> str:
    skill_descriptions = "\n\n".join(
        [
            f"技能名称：{skill.frontmatter.name}\n"
            f"技能描述：{skill.frontmatter.description}\n"
            f"技能路径：{skill.path}"
            for skill in skills
        ]
    )

    return (
        "你是一个全能的AI助手，擅长使用各种工具来辅助获取信息，帮助你回答问题。\n\n"
        "以下是你可以使用的技能列表, 决定使用哪个技能后使用read_file工具来获取技能的详细内容：\n\n"
        f"{skill_descriptions}\n\n"
        "当用户提问时，你会根据问题内容选择合适的技能来辅助回答。"
    )


def _serialize_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _tool_name(part: Dict[str, Any]) -> str:
    return str(part.get("type", ""))[5:]


def _part_is_tool(part: Dict[str, Any]) -> bool:
    return str(part.get("type", "")).startswith("tool-")


def _text_from_parts(parts: List[Dict[str, Any]]) -> str:
    return "".join(str(part.get("text", "")) for part in parts if part.get("type") == "text")


def _split_assistant_steps(parts: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    blocks: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []

    for part in parts:
        # UI 协议用 `step-start` 区分每一轮推理/工具调用，
        # 这里重建历史时也要保留这层边界。
        if part.get("type") == "step-start":
            if current:
                blocks.append(current)
            current = []
            continue

        if part.get("type") == "text" or _part_is_tool(part):
            current.append(part)

    if current:
        blocks.append(current)

    return blocks


def convert_ui_messages_to_model_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # 浏览器传来的是 AI SDK 的 UIMessage，模型侧则需要
    # chat completions 风格的消息，以及成对出现的工具调用/工具结果。
    model_messages: List[Dict[str, Any]] = []

    for message in messages:
        role = message.get("role")
        parts = message.get("parts") or []

        if role == "system":
            text = _text_from_parts(parts)
            if text:
                model_messages.append({"role": "system", "content": text})
            continue

        if role == "user":
            text = _text_from_parts(parts)
            if text:
                model_messages.append({"role": "user", "content": text})
            continue

        if role != "assistant":
            continue

        for block in _split_assistant_steps(parts):
            # assistant 文本和 tool call 属于同一轮 assistant 发言，
            # 但 tool output 需要追加为独立的 `tool` 角色消息。
            text_content = "".join(str(part.get("text", "")) for part in block if part.get("type") == "text")
            tool_calls: List[Dict[str, Any]] = []
            tool_results: List[Dict[str, Any]] = []

            for part in block:
                if not _part_is_tool(part):
                    continue

                state = part.get("state")
                tool_name = _tool_name(part)
                tool_call_id = str(part.get("toolCallId") or uuid.uuid4())
                tool_input = part.get("input") or {}

                # 处于流式输入中的半成品 tool input 不适合写回历史消息。
                if state != "input-streaming":
                    tool_calls.append(
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": _serialize_json(tool_input),
                            },
                        }
                    )

                if state == "output-available":
                    tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": _serialize_json(part.get("output")),
                        }
                    )
                elif state == "output-error":
                    tool_results.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": str(part.get("errorText", "Tool execution failed.")),
                        }
                    )

            if text_content or tool_calls:
                assistant_message: Dict[str, Any] = {
                    "role": "assistant",
                    "content": text_content,
                }
                if tool_calls:
                    assistant_message["tool_calls"] = tool_calls
                model_messages.append(assistant_message)

            model_messages.extend(tool_results)

    return model_messages


def _chat_completions_url() -> str:
    base_url = settings.llm.base_url.rstrip("/")
    if not base_url:
        raise RuntimeError("LLM base_url is not configured. Set llm.provider in config.yaml.")
    return f"{base_url}/chat/completions"


def _stream_model(messages: List[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    """流式调用模型，逐个 yield SSE chunk（已解析为 dict）。"""
    api_key = settings.llm.api_key
    if not api_key:
        raise RuntimeError("LLM api_key is not configured. Set llm.provider in config.yaml.")

    payload = {
        "model": settings.llm.model,
        "temperature": 0.2,
        "messages": messages,
        "tools": registry.get_schemas(),
        "stream": True,
    }

    proxy = settings.llm.proxy
    print(f"Calling model at: {_chat_completions_url()}")

    # connect_timeout=30s，read_timeout=None（流式不限单次读超时）
    timeout = httpx.Timeout(connect=30, read=None, write=30, pool=10)

    try:
        with httpx.Client(proxy=proxy, timeout=timeout) as client:
            with client.stream(
                "POST",
                _chat_completions_url(),
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            ) as resp:
                if resp.status_code != 200:
                    body = resp.read().decode()
                    raise RuntimeError(f"LLM request failed: {resp.status_code} {body}")
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                        # 部分 provider 在最后一个 chunk 里附带 usage 统计
                        if chunk.get("usage"):
                            usage_stats.record(chunk["usage"])
                        yield chunk
                    except json.JSONDecodeError:
                        continue
    except httpx.ConnectTimeout as exc:
        raise RuntimeError("LLM 连接超时（30s），请检查网络或代理配置") from exc
    except httpx.RequestError as exc:
        raise RuntimeError(f"LLM request failed: {exc}") from exc


def _sse_line(chunk: Dict[str, Any]) -> bytes:
    return f"data: {_serialize_json(chunk)}\n\n".encode("utf-8")


def _emit_text_chunks(text: str) -> Iterator[bytes]:
    # AI SDK 的 UI 流协议要求每段文本都按 start/delta/end 事件输出。
    text_id = f"text-{uuid.uuid4().hex}"
    yield _sse_line({"type": "text-start", "id": text_id})
    if text:
        yield _sse_line({"type": "text-delta", "id": text_id, "delta": text})
    yield _sse_line({"type": "text-end", "id": text_id})


def stream_chat(payload: ChatRequest) -> Iterable[bytes]:
    message_id = f"msg-{uuid.uuid4().hex}"
    yield _sse_line({"type": "start", "messageId": message_id})

    try:
        messages = [{"role": "system", "content": construct_system_prompt(list_skills())}]
        messages.extend(convert_ui_messages_to_model_messages(payload.messages))

        for _ in range(MAX_STEPS):
            # 聚合流式 chunk，同时实时 yield 文本 delta
            text_id = f"text-{uuid.uuid4().hex}"
            text_started = False
            accumulated_text = ""
            tool_calls_map: Dict[str, Dict[str, Any]] = {}  # index -> tool_call
            finish_reason = "stop"

            yield _sse_line({"type": "start-step"})

            for chunk in _stream_model(messages):
                choice = ((chunk.get("choices") or [{}])[0])
                finish_reason = choice.get("finish_reason") or finish_reason
                delta = choice.get("delta") or {}

                # 文本 delta
                content = delta.get("content") or ""
                if content:
                    if not text_started:
                        yield _sse_line({"type": "text-start", "id": text_id})
                        text_started = True
                    accumulated_text += content
                    yield _sse_line({"type": "text-delta", "id": text_id, "delta": content})

                # 工具调用 delta（按 index 聚合）
                for tc_delta in (delta.get("tool_calls") or []):
                    idx = str(tc_delta.get("index", 0))
                    if idx not in tool_calls_map:
                        tool_calls_map[idx] = {
                            "id": tc_delta.get("id", ""),
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        }
                    entry = tool_calls_map[idx]
                    if tc_delta.get("id"):
                        entry["id"] = tc_delta["id"]
                    fn = tc_delta.get("function") or {}
                    if fn.get("name"):
                        entry["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        entry["function"]["arguments"] += fn["arguments"]

            if text_started:
                yield _sse_line({"type": "text-end", "id": text_id})

            tool_calls = [tool_calls_map[k] for k in sorted(tool_calls_map)]

            if tool_calls:
                # 把 assistant 的 tool call 写入历史
                messages.append({
                    "role": "assistant",
                    "content": accumulated_text,
                    "tool_calls": tool_calls,
                })

                for tool_call in tool_calls:
                    function = tool_call.get("function") or {}
                    tool_name = str(function.get("name", ""))
                    tool_call_id = str(tool_call.get("id") or uuid.uuid4())
                    raw_arguments = function.get("arguments") or "{}"

                    try:
                        tool_input = json.loads(raw_arguments)
                    except json.JSONDecodeError:
                        tool_input = {}

                    yield _sse_line({
                        "type": "tool-input-available",
                        "toolCallId": tool_call_id,
                        "toolName": tool_name,
                        "input": tool_input,
                    })

                    output_type, output_value = registry.execute(tool_name, tool_input)
                    yield _sse_line({
                        "type": output_type,
                        "toolCallId": tool_call_id,
                        **({"output": output_value} if output_type == "tool-output-available" else {"errorText": output_value}),
                    })

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": _serialize_json(output_value),
                    })

                yield _sse_line({"type": "finish-step"})
                continue

            # 纯文本回复
            if not text_started:
                yield from _emit_text_chunks("（模型返回了空响应）")
            yield _sse_line({"type": "finish-step"})
            yield _sse_line({"type": "finish", "finishReason": finish_reason})
            return

        # 防止模型反复请求工具导致循环跑不出来。
        yield from _emit_text_chunks("本轮工具调用次数已达上限，请缩小问题范围后再试。")
        yield _sse_line({"type": "finish-step"})
        yield _sse_line({"type": "finish", "finishReason": "length"})
    except Exception as exc:
        # 后端异常也走流式事件返回，避免前端只看到一条静默断开的连接。
        yield _sse_line({"type": "error", "errorText": str(exc)})
        yield _sse_line({"type": "finish", "finishReason": "error"})
