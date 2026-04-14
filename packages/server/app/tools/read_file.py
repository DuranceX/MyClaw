"""read_file 工具：读取仓库内的文件内容。

每个工具独立一个文件，包含：
  1. 输入参数的 Pydantic model（ReadFileInput）
  2. 执行函数（_execute）
  3. 工具定义实例（READ_FILE_TOOL）

这种结构对应 Claude Code 的 tools/FileReadTool/ 目录模式：
  每个工具是一个独立模块，自己定义 schema、执行逻辑和安全属性，
  不需要修改任何其他文件就能理解这个工具的完整行为。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.models import ReadFileResponse
from app.services.files import read_repo_file
from app.tools.base import ToolDef


class ReadFileInput(BaseModel):
    """read_file 工具的输入参数。

    为什么单独定义 Input model 而不是复用 models.py 里的 ReadFileRequest？
      ReadFileRequest 是 HTTP API 的请求体模型，语义上属于"外部接口"。
      ReadFileInput 是工具调用的参数模型，语义上属于"工具内部"。
      两者现在字段相同，但未来可能分别演化（比如工具参数加了 encoding 选项，
      但 HTTP API 不需要），所以保持独立更清晰。
    """

    file_path: str = Field(
        description="相对于项目根目录的文件路径，例如 skills/weather/SKILL.md 或 packages/web/package.json"
    )


def _execute(input: ReadFileInput) -> ReadFileResponse:
    """执行文件读取。

    注意：read_repo_file 内部已经有路径穿越防护（resolve_repo_path），
    所以这里不需要重复校验，直接调用即可。
    """
    try:
        content = read_repo_file(input.file_path)
        return ReadFileResponse(
            success=True,
            file_path=input.file_path,
            content=content,
        )
    except (ValueError, FileNotFoundError, OSError) as exc:
        return ReadFileResponse(
            success=False,
            file_path=input.file_path,
            error=str(exc),
        )


# 工具定义实例，由 tools/__init__.py 注册到 registry
READ_FILE_TOOL = ToolDef(
    name="read_file",
    description=(
        "根据相对路径读取项目根目录下的文件内容。"
        "适合查看源代码、配置文件、文档等文本文件。"
    ),
    input_model=ReadFileInput,
    execute=_execute,
    # 只读工具：不修改任何文件，is_read_only=True
    # 对应 Claude Code 的 FileReadTool 中 isReadOnly: () => true
    is_read_only=True,
    is_destructive=False,
)
