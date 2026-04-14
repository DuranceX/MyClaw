"""工具系统核心：ToolDef 数据结构 + ToolRegistry 注册表。

设计参考：Claude Code 的 buildTool 工厂模式（src/Tool.ts）。

核心思路：
  每个工具是一个"自描述对象"，包含自己的 schema、执行逻辑和安全属性。
  注册表负责收集工具，调用方（chat.py）只和注册表打交道，不需要知道工具的内部细节。

这样做的好处：
  - 新增工具只需新建一个文件 + 在 __init__.py 注册一行，不需要改 chat.py
  - 工具可以独立测试，不需要 mock 整个 chat.py
  - schema 和执行逻辑放在一起，不会出现"schema 说有这个参数但代码里没处理"的情况
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, Type

from pydantic import BaseModel, ValidationError


@dataclass
class ToolDef:
    """单个工具的完整定义。

    对应 Claude Code 的 buildTool() 返回值（src/Tool.ts）。

    为什么用 dataclass 而不是普通 dict？
      - 有类型提示，IDE 能补全字段名
      - 可以定义方法（to_openai_schema），把"如何描述自己"的逻辑封装在工具内部
      - 比 class 少样板代码，比 TypedDict 更灵活

    为什么 input_model 用 Pydantic BaseModel 而不是手写 JSON Schema？
      - Pydantic 自动生成 JSON Schema（model_json_schema()），schema 和代码永远同步
      - 入参自动验证，类型错误有明确的报错信息
      - 工具函数内部可以用 input.file_path 而不是 input.get("file_path", "")，IDE 能补全
    """

    name: str
    description: str

    # Pydantic model 类（不是实例），用于：
    # 1. 自动生成 JSON Schema 传给 LLM
    # 2. 验证 LLM 返回的工具调用参数
    input_model: Type[BaseModel]

    # 执行函数：接收已验证的 Pydantic 实例，返回任意可序列化的值
    execute: Callable[[BaseModel], Any]

    # ── 安全属性（对应 Claude Code 的 isReadOnly / isDestructive）──────────
    #
    # 为什么默认值都是 False（fail-closed 原则）？
    #   Claude Code 的 TOOL_DEFAULTS 也是这样设计的：
    #   - is_read_only 默认 False → 未声明的工具被当作"可能写入"，更保守
    #   - is_destructive 默认 False → 未声明的工具不会触发额外警告
    #   这样即使忘记声明，系统也会选择更安全的行为，而不是假设工具是安全的。
    #
    # 这两个字段现在只是声明，未来可以在 ToolRegistry.execute() 里加权限检查逻辑。
    is_read_only: bool = False
    is_destructive: bool = False

    def to_openai_schema(self) -> Dict[str, Any]:
        """把工具定义转成 OpenAI function calling 格式的 JSON Schema。

        为什么这个方法放在 ToolDef 上而不是放在 ToolRegistry 里？
          "如何描述自己"是工具自身的职责（单一职责原则）。
          ToolRegistry 只负责收集和分发，不应该知道每个工具的 schema 细节。

        为什么要去掉 title 和 $defs？
          Pydantic 生成的 schema 包含这些字段，但 OpenAI API 不需要它们。
          保留会浪费 token，某些模型还可能因为不认识这些字段而报错。
        """
        schema = self.input_model.model_json_schema()

        # 去掉 Pydantic 生成的元数据字段，OpenAI 不需要这些
        schema.pop("title", None)
        schema.pop("$defs", None)

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": schema,
            },
        }


class ToolRegistry:
    """工具注册表：收集所有工具，提供统一的 schema 获取和执行接口。

    对应 Claude Code 中 tools.ts 里的工具集合管理逻辑。

    为什么需要注册表？
      如果没有注册表，chat.py 就需要直接 import 每个工具并手动维护列表。
      注册表把这个"知道有哪些工具"的职责集中到一处，chat.py 只需要调用
      registry.get_schemas() 和 registry.execute()，不需要关心工具的细节。
    """

    def __init__(self) -> None:
        # 用 dict 存储，key 是工具名，方便 O(1) 查找
        self._tools: Dict[str, ToolDef] = {}

    def register(self, tool: ToolDef) -> None:
        """注册一个工具。重复注册同名工具会覆盖旧的。"""
        self._tools[tool.name] = tool

    def get_schemas(self) -> List[Dict[str, Any]]:
        """返回所有工具的 OpenAI function calling schema 列表。

        这个列表直接传给 LLM 的 tools 参数，告诉模型"你可以调用哪些工具"。
        """
        return [tool.to_openai_schema() for tool in self._tools.values()]

    def execute(
        self,
        name: str,
        raw_input: Dict[str, Any],
    ) -> Tuple[str, Any]:
        """执行指定工具，返回 (event_type, result) 元组。

        event_type 对应 Vercel AI SDK 的流式事件类型：
          - "tool-output-available"：执行成功
          - "tool-output-error"：执行失败

        为什么在这里统一处理 ValidationError？
          如果让每个工具自己处理验证错误，代码会重复，而且各工具的错误格式可能不一致。
          集中处理保证了 chat.py 拿到的 (event_type, result) 格式永远统一。

        为什么捕获所有 Exception 而不只是 ValidationError？
          工具执行过程中可能抛出各种异常（文件不存在、命令超时等）。
          统一捕获后转成错误事件，让 LLM 能看到错误信息并决定下一步，
          而不是让整个流式响应崩溃。
        """
        tool = self._tools.get(name)
        if tool is None:
            return "tool-output-error", f"Unknown tool: {name}"

        try:
            # 用 Pydantic 验证并转换入参
            # 如果 LLM 传来的参数类型不对或缺少必填字段，这里会抛 ValidationError
            validated_input = tool.input_model.model_validate(raw_input)
            result = tool.execute(validated_input)
            # Pydantic model 实例不能直接被 json.dumps 序列化，
            # 统一在这里转成 dict，工具函数不需要关心这个细节。
            if isinstance(result, BaseModel):
                result = result.model_dump()
            return "tool-output-available", result

        except ValidationError as exc:
            # 参数验证失败：把 Pydantic 的错误信息格式化后返回给 LLM
            # LLM 看到这个错误后通常会修正参数重试
            errors = exc.errors()
            error_msg = "; ".join(
                f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}"
                for e in errors
            )
            return "tool-output-error", f"Invalid input: {error_msg}"

        except Exception as exc:
            # 执行时异常：直接把错误信息返回给 LLM
            return "tool-output-error", str(exc)
