"""path_guard：所有文件工具共用的路径解析与安全校验。

所有涉及路径的工具（read_file、edit_file、write_file、grep、glob）
统一调用 resolve_path()，不各自实现路径校验逻辑。

安全保证：
  - 防止目录穿越（../../etc/passwd 等）
  - 将操作范围限制在 allowed_root 内（由 config.yaml 的 tools.file_access_root 控制）
"""
from __future__ import annotations

from pathlib import Path

from app.config import PROJECT_ROOT, settings


def get_allowed_root() -> Path:
    """返回当前配置的允许根目录（绝对路径）。

    file_access_root 为空 → PROJECT_ROOT（整个项目）
    file_access_root 为相对路径 → PROJECT_ROOT / file_access_root
    """
    root_setting = settings.tools.file_access_root.strip()
    if not root_setting:
        return PROJECT_ROOT
    candidate = (PROJECT_ROOT / root_setting).resolve()
    # 防止 file_access_root 本身穿越出项目根目录
    if not candidate.is_relative_to(PROJECT_ROOT):
        return PROJECT_ROOT
    return candidate


def resolve_path(relative_path: str) -> Path:
    """把相对路径解析为绝对路径，并校验在 allowed_root 内。

    Args:
        relative_path: 相对于项目根目录的路径，如 ".skills/weather/SKILL.md"

    Returns:
        解析后的绝对 Path 对象

    Raises:
        ValueError: 路径穿越 allowed_root，或路径为空
    """
    if not relative_path or not relative_path.strip():
        raise ValueError("file_path 不能为空")

    allowed_root = get_allowed_root()
    absolute_path = (PROJECT_ROOT / relative_path).resolve()

    if not absolute_path.is_relative_to(allowed_root):
        raise ValueError(
            f"路径 '{relative_path}' 超出允许范围 '{allowed_root.relative_to(PROJECT_ROOT) or '.'}'"
        )

    return absolute_path
