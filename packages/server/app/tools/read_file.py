"""read_file 工具：读取仓库内的文件内容。

每个工具独立一个文件，包含：
  1. 输入参数的 Pydantic model（ReadFileInput）
  2. 执行函数（_execute）
  3. 工具定义实例（READ_FILE_TOOL）
"""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from app.config import PROJECT_ROOT
from app.models import ReadFileResponse
from app.tools.base import ToolDef


class ReadFileInput(BaseModel):
    file_path: str = Field(
        description="相对于项目根目录的文件路径，例如 skills/weather/SKILL.md 或 packages/web/package.json"
    )


def _resolve_path(relative_path: str) -> Path:
    """把仓库相对路径解析为绝对路径，并阻止目录穿越。"""
    absolute_path = (PROJECT_ROOT / relative_path).resolve()
    if not absolute_path.is_relative_to(PROJECT_ROOT):
        raise ValueError(f"Illegal path: {relative_path}")
    return absolute_path


def _execute(input: ReadFileInput) -> ReadFileResponse:
    try:
        content = _resolve_path(input.file_path).read_text(encoding="utf-8")
        return ReadFileResponse(success=True, file_path=input.file_path, content=content)
    except (ValueError, FileNotFoundError, OSError) as exc:
        return ReadFileResponse(success=False, file_path=input.file_path, error=str(exc))


READ_FILE_TOOL = ToolDef(
    name="read_file",
    description=(
        "根据相对路径读取项目根目录下的文件内容。"
        "适合查看源代码、配置文件、文档等文本文件。"
    ),
    input_model=ReadFileInput,
    execute=_execute,
    is_read_only=True,
    is_destructive=False,
)
