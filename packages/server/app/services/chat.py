from __future__ import annotations

import json
import os
import uuid
from typing import Any, Dict, Iterable, Iterator, List
from urllib import error, request

from app.models import ChatRequest, SkillEntry
from app.services.skills import list_skills
from app.tools import registry


# DEFAULT_MODEL = "gpt-5.4"
XAI_MODEL = "grok-4.20-beta-latest-reasoning"
MAX_STEPS = 50

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
    base_url = os.getenv("XAI_BASE_URL", "").rstrip("/")
    print(f"XAI_BASE_URL: {base_url}")
    if not base_url:
        raise RuntimeError("XAI_BASE_URL is not configured.")
    return f"{base_url}/chat/completions"


def _call_model(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise RuntimeError("XAI_API_KEY is not configured.")

    payload = {
        "model": os.getenv("XAI_MODEL", XAI_MODEL),
        "temperature": 0.2,
        "messages": messages,
        "tools": registry.get_schemas(),
    }

    req = request.Request(
        _chat_completions_url(),
        data=_serialize_json(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    print(f"Calling model at: {req.full_url}")

    try:
        with request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM request failed: {exc.code} {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"LLM request failed: {exc.reason}") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("LLM returned invalid JSON.") from exc


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
            response = _call_model(messages)
            choice = ((response.get("choices") or [{}])[0]).get("message") or {}
            finish_reason = ((response.get("choices") or [{}])[0]).get("finish_reason") or "stop"
            tool_calls = choice.get("tool_calls") or []
            text = choice.get("content") or ""

            if tool_calls:
                yield _sse_line({"type": "start-step"})
                # 先把 assistant 的 tool call 写入历史，再执行工具，
                # 这样下一轮模型请求拿到的上下文才是完整的。
                messages.append(
                    {
                        "role": "assistant",
                        "content": text,
                        "tool_calls": tool_calls,
                    }
                )

                for tool_call in tool_calls:
                    function = tool_call.get("function") or {}
                    tool_name = str(function.get("name", ""))
                    tool_call_id = str(tool_call.get("id") or uuid.uuid4())
                    raw_arguments = function.get("arguments") or "{}"

                    try:
                        tool_input = json.loads(raw_arguments)
                    except json.JSONDecodeError:
                        tool_input = {}

                    # 输出与 AI SDK 原生路由一致的工具事件，
                    # 这样现有前端聊天 UI 就不需要跟着改。
                    yield _sse_line(
                        {
                            "type": "tool-input-available",
                            "toolCallId": tool_call_id,
                            "toolName": tool_name,
                            "input": tool_input,
                        }
                    )

                    output_type, output_value = registry.execute(tool_name, tool_input)
                    yield _sse_line(
                        {
                            "type": output_type,
                            "toolCallId": tool_call_id,
                            **({"output": output_value} if output_type == "tool-output-available" else {"errorText": output_value}),
                        }
                    )

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": _serialize_json(output_value),
                        }
                    )

                yield _sse_line({"type": "finish-step"})
                continue

            yield _sse_line({"type": "start-step"})
            yield from _emit_text_chunks(text)
            yield _sse_line({"type": "finish-step"})
            yield _sse_line({"type": "finish", "finishReason": finish_reason})
            return

        # 防止模型反复请求工具导致循环跑不出来。
        yield _sse_line({"type": "start-step"})
        yield from _emit_text_chunks("本轮工具调用次数已达上限，请缩小问题范围后再试。")
        yield _sse_line({"type": "finish-step"})
        yield _sse_line({"type": "finish", "finishReason": "length"})
    except Exception as exc:
        # 后端异常也走流式事件返回，避免前端只看到一条静默断开的连接。
        yield _sse_line({"type": "error", "errorText": str(exc)})
        yield _sse_line({"type": "finish", "finishReason": "error"})
