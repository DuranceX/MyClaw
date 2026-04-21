"""write_file 工具：创建新文件或完全覆盖已有文件。

适合：
  - 创建全新文件
  - 文件需要大幅重写（edit_file 的 old_string 会很长时）

不适合：
  - 只修改文件的一小部分 → 用 edit_file
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import ToolDef
from app.tools.path_guard import resolve_path


class WriteFileInput(BaseModel):
    file_path: str = Field(description="相对于项目根目录的文件路径")
    content: str = Field(description="要写入的完整文件内容")


class WriteFileOutput(BaseModel):
    success: bool
    file_path: str = ""
    error: str = ""


def _execute(input: WriteFileInput) -> WriteFileOutput:
    try:
        path = resolve_path(input.file_path)
    except ValueError as exc:
        return WriteFileOutput(success=False, error=str(exc))

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(input.content, encoding="utf-8")
    except OSError as exc:
        return WriteFileOutput(success=False, error=str(exc))

    return WriteFileOutput(success=True, file_path=input.file_path)


WRITE_FILE_TOOL = ToolDef(
    name="write_file",
    description=(
        "创建新文件或完全覆盖已有文件。自动创建父目录。"
        "适合创建全新文件或大幅重写整个文件。"
        "如果只需修改文件的一部分，请优先使用 edit_file。"
    ),
    input_model=WriteFileInput,
    execute=_execute,
    is_read_only=False,
    is_destructive=True,
    # TODO: 当权限系统实现后，is_destructive=True 应触发用户确认
)
