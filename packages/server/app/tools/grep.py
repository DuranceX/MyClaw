"""grep 工具：在项目文件中搜索匹配正则表达式的内容。

优先使用系统 grep 命令，不可用时降级为纯 Python pathlib 实现。
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.tools.base import ToolDef
from app.tools.path_guard import get_allowed_root, resolve_path

_MAX_LINES = 200
_EXCLUDED_DIRS = {".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build"}


class GrepInput(BaseModel):
    pattern: str = Field(description="正则表达式，例如 def _execute 或 import.*httpx")
    path: str = Field(default="", description="搜索目录，相对路径，空=allowed_root")
    glob: str = Field(default="", description="文件过滤，例如 *.py 或 *.ts")
    output_mode: Literal["content", "files_with_matches", "count"] = Field(
        default="files_with_matches",
        description="content=显示匹配行, files_with_matches=只显示文件路径, count=统计匹配数",
    )
    context_lines: int = Field(default=0, ge=0, le=10, description="上下文行数（-C N）")


class GrepOutput(BaseModel):
    matches: List[str]
    truncated: bool = False


def _search_dir(input: GrepInput) -> Path:
    """解析搜索目录，空路径返回 allowed_root。"""
    if not input.path.strip():
        return get_allowed_root()
    return resolve_path(input.path)


def _grep_with_command(input: GrepInput, search_dir: Path) -> GrepOutput:
    """使用系统 grep 命令搜索。"""
    cmd = ["grep", "-rn", "--include-dir=*"]

    # 排除噪音目录
    for d in _EXCLUDED_DIRS:
        cmd += ["--exclude-dir", d]

    if input.glob:
        cmd += ["--include", input.glob]

    if input.output_mode == "files_with_matches":
        cmd += ["-l"]
    elif input.output_mode == "count":
        cmd += ["-c"]

    if input.context_lines > 0 and input.output_mode == "content":
        cmd += ["-C", str(input.context_lines)]

    cmd += [input.pattern, str(search_dir)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=15,
        )
        lines = [l for l in result.stdout.splitlines() if l]
        # 转为相对路径，减少 token 消耗
        rel_lines = []
        from app.config import PROJECT_ROOT
        for line in lines:
            try:
                # grep 输出格式：/abs/path/file:line:content 或 /abs/path/file
                parts = line.split(":", 1)
                abs_part = parts[0]
                rest = (":" + parts[1]) if len(parts) > 1 else ""
                rel = str(Path(abs_part).relative_to(PROJECT_ROOT))
                rel_lines.append(rel + rest)
            except (ValueError, IndexError):
                rel_lines.append(line)

        truncated = len(rel_lines) > _MAX_LINES
        return GrepOutput(matches=rel_lines[:_MAX_LINES], truncated=truncated)
    except subprocess.TimeoutExpired:
        return GrepOutput(matches=[], truncated=False)


def _grep_with_pathlib(input: GrepInput, search_dir: Path) -> GrepOutput:
    """纯 Python 降级实现。"""
    from app.config import PROJECT_ROOT

    try:
        regex = re.compile(input.pattern)
    except re.error as exc:
        raise ValueError(f"无效的正则表达式: {exc}") from exc

    glob_pattern = input.glob if input.glob else "**/*"
    matches: List[str] = []
    file_match_counts: dict = {}

    for file_path in search_dir.glob(glob_pattern):
        if not file_path.is_file():
            continue
        # 排除噪音目录
        if any(part in _EXCLUDED_DIRS for part in file_path.parts):
            continue
        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        rel = str(file_path.relative_to(PROJECT_ROOT))
        lines = text.splitlines()
        file_hits = []
        for i, line in enumerate(lines, 1):
            if regex.search(line):
                file_hits.append((i, line))

        if not file_hits:
            continue

        if input.output_mode == "files_with_matches":
            matches.append(rel)
        elif input.output_mode == "count":
            matches.append(f"{rel}:{len(file_hits)}")
        else:  # content
            for lineno, line in file_hits:
                matches.append(f"{rel}:{lineno}:{line}")

        if len(matches) >= _MAX_LINES:
            return GrepOutput(matches=matches[:_MAX_LINES], truncated=True)

    return GrepOutput(matches=matches, truncated=False)


def _execute(input: GrepInput) -> GrepOutput:
    try:
        search_dir = _search_dir(input)
    except ValueError as exc:
        return GrepOutput(matches=[f"错误: {exc}"], truncated=False)

    if shutil.which("grep"):
        return _grep_with_command(input, search_dir)
    return _grep_with_pathlib(input, search_dir)


GREP_TOOL = ToolDef(
    name="grep",
    description=(
        "在项目文件中搜索匹配正则表达式的内容。"
        "output_mode=files_with_matches（默认）只返回文件路径，token 消耗最少；"
        "output_mode=content 返回匹配行及上下文；"
        "output_mode=count 返回每个文件的匹配数量。"
    ),
    input_model=GrepInput,
    execute=_execute,
    is_read_only=True,
    is_destructive=False,
)
