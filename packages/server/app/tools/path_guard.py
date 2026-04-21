"""path_guard：所有文件工具共用的路径解析与安全校验。

安全规则（按优先级）：
  1. 路径必须在 allowed_root 内（防目录穿越）
  2. 路径不能命中 exclude_files 中的任何条目

allowed_root 来源：settings.security.file_access_root
  - 空字符串 → PROJECT_ROOT
  - 绝对路径（如 /Users/me/Code）→ 直接使用

exclude_files 来源：settings.security.exclude_files
  - 支持绝对路径，也支持相对于 allowed_root 的相对路径
  - 目录末尾加不加 / 均可

路径输入规则（resolve_path）：
  - 绝对路径 → 直接 resolve，以 allowed_root 做权限校验
  - 相对路径 → 以 PROJECT_ROOT 为基准拼接，以 allowed_root 做权限校验
"""
from __future__ import annotations

from pathlib import Path
from typing import List

from app.config import PROJECT_ROOT, settings


def get_allowed_root() -> Path:
    """返回当前配置的允许根目录（绝对路径）。"""
    root_setting = settings.security.file_access_root.strip()
    if not root_setting:
        return PROJECT_ROOT
    candidate = Path(root_setting).expanduser().resolve()
    return candidate


def _get_exclude_paths(allowed_root: Path) -> List[Path]:
    """把 exclude_files 配置解析为绝对路径列表。"""
    result: List[Path] = []
    for entry in settings.security.exclude_files:
        entry = entry.strip().rstrip("/")
        if not entry:
            continue
        p = Path(entry)
        if p.is_absolute():
            result.append(p.resolve())
        else:
            result.append((allowed_root / entry).resolve())
    return result


def _is_excluded(path: Path, exclude_paths: List[Path]) -> bool:
    """判断 path 是否命中排除列表（path 本身或其任意父目录被排除）。"""
    for excluded in exclude_paths:
        try:
            path.relative_to(excluded)
            return True
        except ValueError:
            pass
        if path == excluded:
            return True
    return False


def resolve_path(input_path: str) -> Path:
    """把输入路径解析为绝对路径，并做安全校验。

    Args:
        input_path: 绝对路径或相对于 PROJECT_ROOT 的相对路径

    Returns:
        解析后的绝对 Path 对象

    Raises:
        ValueError: 路径为空、超出 allowed_root、或命中 exclude_files
    """
    if not input_path or not input_path.strip():
        raise ValueError("file_path 不能为空")

    p = Path(input_path.strip()).expanduser()
    if p.is_absolute():
        absolute_path = p.resolve()
    else:
        absolute_path = (PROJECT_ROOT / p).resolve()

    allowed_root = get_allowed_root()

    if not absolute_path.is_relative_to(allowed_root):
        raise ValueError(
            f"路径 '{input_path}' 超出允许范围 '{allowed_root}'。"
            f"如需访问该路径，请在 config.yaml 的 security.file_access_root 中配置更大的根目录。"
        )

    exclude_paths = _get_exclude_paths(allowed_root)
    if _is_excluded(absolute_path, exclude_paths):
        raise ValueError(
            f"路径 '{input_path}' 已被 security.exclude_files 排除，无法访问。"
        )

    return absolute_path
