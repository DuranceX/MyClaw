from __future__ import annotations

from pathlib import Path

from app.config import PROJECT_ROOT


def resolve_repo_path(relative_path: str) -> Path:
    """把仓库相对路径解析为绝对路径，并阻止目录穿越。

    Args:
        relative_path: 相对于仓库根目录的路径。

    Returns:
        Path: 仓库内部的绝对路径。

    Raises:
        ValueError: 当解析后的路径逃逸出仓库根目录时抛出。
    """
    absolute_path = (PROJECT_ROOT / relative_path).resolve()
    if not absolute_path.is_relative_to(PROJECT_ROOT):
        raise ValueError(f"Illegal path: {relative_path}")
    return absolute_path


def read_repo_file(relative_path: str) -> str:
    """读取仓库中的 UTF-8 文本文件。

    Args:
        relative_path: 相对于仓库根目录的路径。

    Returns:
        str: 读取到的文件文本内容。
    """
    absolute_path = resolve_repo_path(relative_path)
    return absolute_path.read_text(encoding="utf-8")
