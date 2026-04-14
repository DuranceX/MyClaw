"""exec_command 工具：在项目根目录执行 shell 命令。

结构和 read_file.py 完全一致：Input model + 执行函数 + 工具定义实例。
这种一致性让开发者看到一个工具文件就能理解所有工具文件的结构。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.models import ExecCommandResponse
from app.services.commands import run_command
from app.tools.base import ToolDef


class ExecCommandInput(BaseModel):
    """exec_command 工具的输入参数。

    直接复用 models.py 里 ExecCommandRequest 的字段定义，
    包括 timeout_ms 的范围约束（ge=100, le=60_000）。

    为什么这里重新定义而不是直接继承 ExecCommandRequest？
      同 ReadFileInput 的理由：工具参数和 HTTP API 请求体语义不同，
      保持独立让两者可以分别演化。
    """

    command: str = Field(
        description="要执行的 shell 命令，例如 ls skills/ 或 python3 scripts/query.py --id 1"
    )
    timeout_ms: int = Field(
        default=10_000,
        ge=100,
        le=60_000,
        description="超时时间（毫秒），默认 10000ms，范围 100-60000ms",
    )


def _execute(input: ExecCommandInput) -> ExecCommandResponse:
    """执行 shell 命令。

    直接委托给 services/commands.py 的 run_command，
    该函数已经处理了超时、非零退出码等情况。
    """
    return run_command(input.command, input.timeout_ms)


# 工具定义实例，由 tools/__init__.py 注册到 registry
EXEC_COMMAND_TOOL = ToolDef(
    name="exec_command",
    description=(
        "在项目根目录下执行命令行命令，返回 stdout 和 stderr。"
        "适合运行脚本、查看目录结构、执行构建命令等操作。"
    ),
    input_model=ExecCommandInput,
    execute=_execute,
    # 命令执行可能有副作用（写文件、修改状态），所以 is_read_only=False
    # 但不默认标记为 is_destructive，因为大多数命令（ls、cat、python 脚本）是安全的
    # 对应 Claude Code 的 BashTool：isReadOnly 根据命令内容动态判断，
    # 这里简化为静态声明
    is_read_only=False,
    is_destructive=False,
)
