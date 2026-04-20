"""工具注册表的公共入口。

这个文件做两件事：
  1. 创建 registry 单例
  2. 显式注册所有工具

为什么用显式注册而不是"自注册"（工具文件 import 时自动注册）？
  自注册依赖 Python 的 import 副作用：工具文件被 import 时，模块级代码执行，
  把自己注册到全局 registry。这种方式的问题是：
  - 如果某个工具文件没有被 import 到，它就不会被注册，这种隐式行为很难排查
  - 测试时很难控制"哪些工具被注册了"
  显式注册在这里一眼就能看到所有工具，新增工具时也知道要来这里加一行。

使用方式（在 chat.py 里）：
  from app.tools import registry

  # 获取所有工具的 schema，传给 LLM
  schemas = registry.get_schemas()

  # 执行工具调用
  event_type, result = registry.execute(tool_name, tool_input)
"""
from app.tools.base import ToolRegistry
from app.tools.exec_command import EXEC_COMMAND_TOOL
from app.tools.read_file import READ_FILE_TOOL
from app.tools.error_test import ERROR_TEST_TOOL

registry = ToolRegistry()
registry.register(READ_FILE_TOOL)
registry.register(EXEC_COMMAND_TOOL)
registry.register(ERROR_TEST_TOOL)

# 如果未来新增工具（比如 web_search、write_file），在这里加一行：
# from app.tools.web_search import WEB_SEARCH_TOOL
# registry.register(WEB_SEARCH_TOOL)
