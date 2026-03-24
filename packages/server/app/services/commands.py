from __future__ import annotations

import subprocess

from app.config import PROJECT_ROOT
from app.models import ExecCommandResponse


def run_command(command: str, timeout_ms: int) -> ExecCommandResponse:
    """在仓库根目录执行 shell 命令，并把结果整理成统一结构。

    Args:
        command: 原始 shell 命令字符串。
        timeout_ms: 最大执行时长，单位为毫秒。

    Returns:
        ExecCommandResponse: 包含 stdout、stderr、成功状态和错误原因的结构化结果。

    关键逻辑:
        非零退出码不会抛 Python 异常，而是作为业务失败写入返回值；
        只有超时会单独进入异常分支处理。
    """
    try:
        completed = subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
            check=False,
        )
        return ExecCommandResponse(
            success=completed.returncode == 0,
            command=command,
            stdout=completed.stdout.strip(),
            stderr=completed.stderr.strip(),
            error=None if completed.returncode == 0 else f"Command exited with code {completed.returncode}",
        )
    except subprocess.TimeoutExpired as exc:
        # 超时时保留部分输出，方便调用方判断命令执行到了哪一步。
        return ExecCommandResponse(
            success=False,
            command=command,
            stdout=(exc.stdout or "").strip(),
            stderr=(exc.stderr or "").strip(),
            error=f"Command timed out after {timeout_ms}ms",
        )
