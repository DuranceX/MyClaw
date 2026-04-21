"""read_file 工具：读取仓库内的文件内容。

每个工具独立一个文件，包含：
  1. 输入参数的 Pydantic model（ReadFileInput）
  2. 执行函数（_execute）
  3. 工具定义实例（READ_FILE_TOOL）
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.models import ReadFileResponse
from app.tools.base import ToolDef
from app.tools.path_guard import resolve_path


class ReadFileInput(BaseModel):
    file_path: str = Field(
        description=(
            "文件路径。支持两种形式：\n"
            "1. 相对路径（相对于项目根目录）：如 packages/web/package.json\n"
            "2. 绝对路径：如 /Users/me/Code/other-project/README.md 或 ~/Code/other-project/README.md\n"
            "当用户提到项目外的文件时，请使用绝对路径。"
        )
    )


def _execute(input: ReadFileInput) -> ReadFileResponse:
    try:
        content = resolve_path(input.file_path).read_text(encoding="utf-8")
        return ReadFileResponse(success=True, file_path=input.file_path, content=content)
    except (ValueError, FileNotFoundError, OSError) as exc:
        return ReadFileResponse(success=False, file_path=input.file_path, error=str(exc))


READ_FILE_TOOL = ToolDef(
    name="read_file",
    description=(
        "读取文件内容。支持相对路径（相对于项目根目录）和绝对路径（含 ~ 展开）。"
        "当用户提到项目外的文件（如 ~/Code/other-project/package.json）时，"
        "优先使用此工具而非 exec_command cat。"
        "适合查看源代码、配置文件、文档等文本文件。"
    ),
    input_model=ReadFileInput,
    execute=_execute,
    is_read_only=True,
    is_destructive=False,
)
