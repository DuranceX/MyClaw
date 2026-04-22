# cloud-mail 查询脚本崩溃修复

修复了邮件查询脚本在成功输出后出现 “Aborted (core dumped)” 和 exit code 134 的问题，确保工具调用返回 `success: true`。

当前相关代码位于：

- `.skills/cloud-mail/scripts/query_mail.mjs` — 邮件查询主脚本（已改为显式 async IIFE + 干净退出）

---

## 背景与动机

用户在使用 cloud-mail 技能查询邮件（包括特定收件人 `ai@starnight.top`）时，发现虽然 stdout 中邮件信息完全正确，但每次执行都返回：
```json
{"success": false, ..., "stderr": "Aborted (core dumped)", "error": "Command exited with code 134"}
```
这导致工具层认为命令失败，影响用户体验。需要彻底解决底层进程退出问题。

## 设计思路

核心思路是将脚本从**顶层 await** 改为**显式 async IIFE** 包裹，并确保在所有路径上都有明确的 `process.exit()` 调用。同时优化邮件内容预览逻辑，使其对 HTML 邮件的清理更健壮，避免潜在的字符串处理异常。

## 具体改动

### .skills/cloud-mail/scripts/query_mail.mjs

- 将主要逻辑包装在 `(async () => { ... })()` 中
- 成功输出后显式调用 `process.exit(0)`
- 改进内容预览：
  ```js
  let preview = m.text || "";
  if (!preview && m.content) {
    preview = m.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  ```
- 简化收件人显示逻辑，增强兼容性
- 更新注释说明修复目的

## 遇到的问题与解决方案

### 问题：Node.js 进程异常终止（core dumped）

**现象**：脚本打印完格式化邮件信息后立即崩溃，退出码 134（SIGABRT），即使 try-catch 也未能捕获。

**原因分析**：顶层 await 在当前执行环境（Node v24 + 工具沙箱）的模块清理阶段存在问题，可能与 fetch 或异步资源释放有关。

**解决方案**： 
1. 改为显式 async 立即执行函数
2. 在成功分支末尾增加 `process.exit(0)`
3. 优化正则清理逻辑，减少潜在异常点
4. 重新编辑文件 → git commit → git push

修复后测试确认：`success: true`，无 stderr，无崩溃，输出正常。

---

**提交记录**  
`153d3a4 fix(cloud-mail): wrap query_mail.mjs in async IIFE + explicit process.exit(0)`

文档生成时间：2026-04-22
