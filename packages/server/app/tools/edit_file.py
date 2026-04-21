"""edit_file 工具：对文件做精确字符串替换。

设计参考 Claude Code 的 FileEditTool：
  - old_string 必须在文件中唯一匹配（replace_all=false 时）
  - 不唯一时报错，提示模型提供更多上下文
  - 支持 replace_all=true 替换所有匹配（适合重命名变量等场景）
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.tools.base import ToolDef
from app.tools.path_guard import resolve_path


class EditFileInput(BaseModel):
    file_path: str = Field(description="相对于项目根目录的文件路径")
    old_string: str = Field(description="要替换的文本，必须在文件中精确匹配")
    new_string: str = Field(description="替换后的文本")
    replace_all: bool = Field(
        default=False,
        description="是否替换所有匹配（默认 false，适合重命名变量等场景时设为 true）",
    )


class EditFileOutput(BaseModel):
    success: bool
    replacements: int = 0
    error: str = ""


def _execute(input: EditFileInput) -> EditFileOutput:
    try:
        path = resolve_path(input.file_path)
    except ValueError as exc:
        return EditFileOutput(success=False, error=str(exc))

    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return EditFileOutput(success=False, error=f"文件不存在: {input.file_path}")
    except OSError as exc:
        return EditFileOutput(success=False, error=str(exc))

    count = content.count(input.old_string)

    if count == 0:
        return EditFileOutput(
            success=False,
            error=(
                f"old_string 在文件中未找到匹配。"
                f"请检查空白字符和缩进是否与文件完全一致。"
            ),
        )

    if not input.replace_all and count > 1:
        return EditFileOutput(
            success=False,
            error=(
                f"old_string 在文件中有 {count} 处匹配，无法确定替换哪一处。"
                f"请在 old_string 中加入更多上下文（如前后几行）使其唯一，"
                f"或设置 replace_all=true 替换所有匹配。"
            ),
        )

    new_content = content.replace(input.old_string, input.new_string)
    replacements = count if input.replace_all else 1

    try:
        path.write_text(new_content, encoding="utf-8")
    except OSError as exc:
        return EditFileOutput(success=False, error=str(exc))

    return EditFileOutput(success=True, replacements=replacements)


EDIT_FILE_TOOL = ToolDef(
    name="edit_file",
    description=(
        "对文件做精确字符串替换。"
        "old_string 必须与文件内容完全匹配（包括空格和缩进）。"
        "replace_all=false（默认）时 old_string 必须在文件中唯一，否则报错。"
        "新增函数时，可将 old_string 设为锚点行（如文件末尾的空行或某个函数结尾），"
        "new_string 设为锚点行 + 新函数内容。"
    ),
    input_model=EditFileInput,
    execute=_execute,
    is_read_only=False,
    is_destructive=False,
    # TODO: 当权限系统实现后，is_destructive 应设为 True（写操作不可逆）
)
