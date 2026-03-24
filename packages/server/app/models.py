from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class SkillFrontmatter(BaseModel):
    name: str
    description: str
    extra: Dict[str, str] = Field(default_factory=dict)


class SkillEntry(BaseModel):
    path: str
    frontmatter: SkillFrontmatter


class ReadFileRequest(BaseModel):
    file_path: str = Field(description="Path relative to the repo root.")


class ReadFileResponse(BaseModel):
    success: bool
    file_path: Optional[str] = None
    content: Optional[str] = None
    error: Optional[str] = None


class ExecCommandRequest(BaseModel):
    command: str = Field(description="Shell command executed from the repo root.")
    timeout_ms: int = Field(default=10_000, ge=100, le=60_000)


class ExecCommandResponse(BaseModel):
    success: bool
    command: str
    stdout: str = ""
    stderr: str = ""
    error: Optional[str] = None


class ApiEnvelope(BaseModel):
    data: Any
