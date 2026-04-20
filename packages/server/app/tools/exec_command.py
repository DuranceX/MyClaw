"""exec_command 工具：在项目根目录执行 shell 命令。"""
from __future__ import annotations

import os
import subprocess

from pydantic import BaseModel, Field

from app.config import PROJECT_ROOT, settings
from app.models import ExecCommandResponse
from app.tools.base import ToolDef


class ExecCommandInput(BaseModel):
    command: str = Field(
        description="要执行的 shell 命令，例如 ls skills/ 或 python3 scripts/query.py --id 1"
    )
    timeout_ms: int = Field(
        default=10_000,
        ge=100,
        le=60_000,
        description="超时时间（毫秒），默认 10000ms，范围 100-60000ms",
    )


def _build_env() -> dict:
    """把 config.yaml 中的工具类凭证注入到子进程环境变量。

    为什么在这里注入而不是让脚本自己读 config.yaml？
      脚本可能是任意语言（Node.js、Python、Shell），
      统一由 Python 侧注入环境变量是最通用的方案，脚本只需读 process.env 即可。
    """
    env = os.environ.copy()
    t = settings.tools
    if t.qweather.api_key:
        env["QWEATHER_API_KEY"] = t.qweather.api_key
    if t.qweather.api_host:
        env["QWEATHER_API_HOST"] = t.qweather.api_host
    if t.serper.api_key:
        env["SERPER_API_KEY"] = t.serper.api_key
    if t.cloud_mail.token:
        env["CLOUD_MAIL_TOKEN"] = t.cloud_mail.token
    return env


def _execute(input: ExecCommandInput) -> ExecCommandResponse:
    try:
        completed = subprocess.run(
            input.command,
            cwd=PROJECT_ROOT,
            shell=True,
            capture_output=True,
            text=True,
            timeout=input.timeout_ms / 1000,
            check=False,
            env=_build_env(),
        )
        return ExecCommandResponse(
            success=completed.returncode == 0,
            command=input.command,
            stdout=completed.stdout.strip(),
            stderr=completed.stderr.strip(),
            error=None if completed.returncode == 0 else f"Command exited with code {completed.returncode}",
        )
    except subprocess.TimeoutExpired as exc:
        return ExecCommandResponse(
            success=False,
            command=input.command,
            stdout=(exc.stdout or "").strip(),
            stderr=(exc.stderr or "").strip(),
            error=f"Command timed out after {input.timeout_ms}ms",
        )


EXEC_COMMAND_TOOL = ToolDef(
    name="exec_command",
    description=(
        "在项目根目录下执行命令行命令，返回 stdout 和 stderr。"
        "适合运行脚本、查看目录结构、执行构建命令等操作。"
    ),
    input_model=ExecCommandInput,
    execute=_execute,
    is_read_only=False,
    is_destructive=False,
)
