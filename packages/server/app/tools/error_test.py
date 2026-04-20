"""error_test 工具：用于测试各种错误场景的行为。

只在用户明确要求时才会被调用（工具描述里有说明）。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.tools.base import ToolDef


class ErrorTestInput(BaseModel):
    error_type: Literal["validation", "runtime", "timeout_sim", "large_output"] = Field(
        description=(
            "要触发的错误类型：\n"
            "- validation：返回参数校验失败（工具层捕获）\n"
            "- runtime：抛出运行时异常（工具层捕获）\n"
            "- timeout_sim：模拟超时（返回错误字符串，不真正阻塞）\n"
            "- large_output：返回大量文本，测试输出截断行为"
        )
    )


def _execute(input: ErrorTestInput) -> dict:
    if input.error_type == "validation":
        # 主动抛出，由 ToolRegistry 捕获后返回 tool-output-error
        raise ValueError("模拟参数校验失败：字段 'foo' 不能为空")

    if input.error_type == "runtime":
        raise RuntimeError("模拟运行时异常：连接数据库失败 (ECONNREFUSED)")

    if input.error_type == "timeout_sim":
        # 不真正 sleep，避免阻塞服务器；直接返回错误描述
        return {
            "success": False,
            "error": "模拟超时：操作在 10000ms 内未完成",
        }

    if input.error_type == "large_output":
        lines = [f"第 {i} 行：{'x' * 80}" for i in range(1, 201)]
        return {
            "success": True,
            "output": "\n".join(lines),
            "line_count": 200,
        }

    return {"success": True, "message": "未知 error_type"}


ERROR_TEST_TOOL = ToolDef(
    name="error_test",
    description=(
        "【仅用于测试】触发各种错误场景，验证错误处理链路是否正常。"
        "只在用户明确说'测试错误'、'触发错误'、'error_test'时才调用，"
        "不要在正常任务中主动使用此工具。"
    ),
    input_model=ErrorTestInput,
    execute=_execute,
    is_read_only=True,
    is_destructive=False,
)
