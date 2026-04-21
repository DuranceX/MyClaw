"""glob 工具：按文件名模式匹配项目内的文件路径。"""
from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import BaseModel, Field

from app.config import PROJECT_ROOT
from app.tools.base import ToolDef
from app.tools.path_guard import get_allowed_root, resolve_path

_MAX_FILES = 100
_EXCLUDED_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build"}


class GlobInput(BaseModel):
    pattern: str = Field(description="glob 模式，例如 **/*.py 或 packages/server/**/*.py")
    path: str = Field(default="", description="搜索目录，相对路径，空=allowed_root")


class GlobOutput(BaseModel):
    files: List[str]
    truncated: bool = False


def _execute(input: GlobInput) -> GlobOutput:
    try:
        if not input.path.strip():
            search_dir = get_allowed_root()
        else:
            search_dir = resolve_path(input.path)
    except ValueError as exc:
        return GlobOutput(files=[f"错误: {exc}"], truncated=False)

    try:
        all_files = [
            p for p in search_dir.glob(input.pattern)
            if p.is_file() and not any(part in _EXCLUDED_DIRS for part in p.parts)
        ]
    except Exception as exc:
        return GlobOutput(files=[f"错误: {exc}"], truncated=False)

    # 按修改时间降序排序
    all_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    truncated = len(all_files) > _MAX_FILES
    rel_files = [str(p.relative_to(PROJECT_ROOT)) for p in all_files[:_MAX_FILES]]
    return GlobOutput(files=rel_files, truncated=truncated)


GLOB_TOOL = ToolDef(
    name="glob",
    description=(
        "按 glob 模式匹配项目内的文件路径，结果按修改时间降序排序，最多返回 100 条。"
        "适合查找特定类型的文件，例如 **/*.py 找所有 Python 文件，packages/server/**/*.py 限定目录。"
    ),
    input_model=GlobInput,
    execute=_execute,
    is_read_only=True,
    is_destructive=False,
)
