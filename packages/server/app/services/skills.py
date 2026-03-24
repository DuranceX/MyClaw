from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from app.config import PROJECT_ROOT, SKILLS_DIR
from app.models import SkillEntry, SkillFrontmatter


def _extract_frontmatter_block(content: str) -> Optional[str]:
    """从 SKILL.md 内容中提取原始 frontmatter 文本。

    Args:
        content: 完整的 markdown 文件内容。

    Returns:
        str | None: ``---`` 包裹的 frontmatter 文本；如果文件开头不是
        frontmatter，则返回 ``None``。
    """
    if not content.startswith("---\n"):
        return None

    end_index = content.find("\n---", 4)
    if end_index == -1:
        return None

    return content[4:end_index]


def _parse_frontmatter(block: str) -> Optional[SkillFrontmatter]:
    """解析仓库中 SKILL.md 使用的精简版 YAML frontmatter。

    Args:
        block: 去掉 ``---`` 包裹后的原始 frontmatter 文本。

    Returns:
        SkillFrontmatter | None: 解析后的结构化技能元数据。
        如果缺少 ``name`` 或 ``description`` 等必要字段，则返回 ``None``。

    关键逻辑:
        这里只支持仓库当前实际使用到的两种格式：
        ``key: value`` 和 ``key: >`` 折叠多行文本。
    """
    result: Dict[str, str] = {}
    lines = block.splitlines()
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            index += 1
            continue

        if ":" not in line:
            index += 1
            continue

        key, raw_value = line.split(":", 1)
        key = key.strip()
        raw_value = raw_value.strip()

        if raw_value == ">":
            folded: List[str] = []
            index += 1
            while index < len(lines):
                next_line = lines[index]
                if next_line and not next_line[:1].isspace():
                    break
                folded.append(next_line.strip())
                index += 1
            result[key] = " ".join(part for part in folded if part).strip()
            continue

        result[key] = raw_value
        index += 1

    name = result.pop("name", "").strip()
    description = result.pop("description", "").strip()
    if not name or not description:
        return None

    return SkillFrontmatter(name=name, description=description, extra=result)


def _scan_skill_files(directory: Path) -> List[Path]:
    """递归扫描目录下的全部 ``SKILL.md`` 文件。

    Args:
        directory: 需要扫描的根目录。

    Returns:
        list[Path]: 排序后的绝对路径列表，保证输出稳定。
    """
    return sorted(directory.rglob("SKILL.md"))


def list_skills() -> List[SkillEntry]:
    """构建提供给前端和工具调用层使用的技能索引。

    Returns:
        list[SkillEntry]: 仓库根目录 ``skills/`` 下所有合法技能的列表，
        并按技能名排序，保证 prompt 和接口返回稳定。

    关键逻辑:
        单个 ``SKILL.md`` 如果缺失必要字段，会被跳过，而不会导致整次扫描失败。
    """
    if not SKILLS_DIR.exists():
        return []

    entries: List[SkillEntry] = []
    for absolute_path in _scan_skill_files(SKILLS_DIR):
        content = absolute_path.read_text(encoding="utf-8")
        block = _extract_frontmatter_block(content)
        if block is None:
            continue

        frontmatter = _parse_frontmatter(block)
        if frontmatter is None:
            continue

        entries.append(
            SkillEntry(
                path=absolute_path.relative_to(PROJECT_ROOT).as_posix(),
                frontmatter=frontmatter,
            )
        )

    return sorted(entries, key=lambda item: item.frontmatter.name.lower())
