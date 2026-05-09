---
name: cloud-mail
description: >
  查询 cloud-mail 邮件系统中的邮件信息。当用户想查看邮件、搜索邮件、查收件箱、
  查发件箱、查某人发来的邮件、查某个主题的邮件时触发。例如"帮我查一下有没有来自
  xxx 的邮件"、"查一下最新的收件"、"搜索主题包含 xxx 的邮件"、"看看有没有新邮件"、
  "查邮件"、"收件箱"、"发件箱"等场景。只要涉及邮件查询，优先使用本技能。
---

# cloud-mail 邮件查询

## 技能概述

通过 cloud-mail API 查询邮件列表，支持按收件人、发件人、主题、内容、日期等条件过滤，
支持分页和排序。Token 由后端从 `config.yaml` 自动注入。

## 使用步骤

1. **理解用户意图**：从用户输入中提取过滤条件（发件人、收件人、主题、邮件类型、日期范围等）。**只有用户明确说"收件箱"或"发件箱"时才传 `--type`；仅提到日期、发件人、主题等条件时不要加 `--type`。**
2. **运行查询脚本**：执行 `scripts/query_mail.mjs`，传入对应参数
3. **格式化输出**：将结果以易读方式展示给用户

## 脚本调用方式

```bash
# 查询最新收件（默认按时间倒序，每页20条）
node .skills/cloud-mail/scripts/query_mail.mjs

# 按发件人邮箱搜索
node .skills/cloud-mail/scripts/query_mail.mjs --sendEmail hello@example.com

# 按发件人名字搜索（支持模糊）
node .skills/cloud-mail/scripts/query_mail.mjs --sendName hello

# 按收件人邮箱搜索
node .skills/cloud-mail/scripts/query_mail.mjs --toEmail admin@example.com

# 按主题搜索（支持模糊）
node .skills/cloud-mail/scripts/query_mail.mjs --subject "验证码"

# 只看收件箱（type=0）或发件箱（type=1）
node .skills/cloud-mail/scripts/query_mail.mjs --type 0
node .skills/cloud-mail/scripts/query_mail.mjs --type 1

# 按日期范围筛选（格式 "YYYY-MM-DD HH:mm:ss"，支持单边过滤）
node .skills/cloud-mail/scripts/query_mail.mjs --startTime "2026-04-20 00:00:00" --endTime "2026-04-20 23:59:59"
node .skills/cloud-mail/scripts/query_mail.mjs --startTime "2026-04-20 09:00:00"   # 最近一小时起
node .skills/cloud-mail/scripts/query_mail.mjs --startTime "2026-04-14 00:00:00" --endTime "2026-04-20 23:59:59"  # 本周

# 分页
node .skills/cloud-mail/scripts/query_mail.mjs --num 2 --size 10

# 组合条件
node .skills/cloud-mail/scripts/query_mail.mjs --sendEmail noreply@github.com --subject "PR" --startTime "2026-04-01 00:00:00"
```

## 依赖的环境变量

| 变量名 | 说明 |
|--------|------|
| `CLOUD_MAIL_TOKEN` | cloud-mail API 身份令牌，由后端从 `config.yaml` 自动注入 |

## 输出格式（已修改：取消内容截断）

现在默认输出**完整邮件正文**（不再限制180字符预览）。

```
📬 共找到 1 封邮件
──────────────────────────────────────────────────
[1] 收件
    来自：NextDraft <managingeditor@substack.com>
    收件人： <ai@starnight.top>
    主题：Life is an Information Superhighway
    时间：2026-04-24 19:10:51 (UTC)
    内容：
    View this post on the web at ...

    （以下为完整正文，长度不限）
    ────────────────────────────── 完整内容结束 ──────────────────────────────
──────────────────────────────────────────────────
```

**重要变更**：移除了内容预览截断逻辑。现在 `query_mail.mjs` 会优先输出 `m.text`，若无则清理 HTML 后输出完整正文。适合用户需要“完整内容翻译版”等场景。

未找到邮件时，告知用户并建议调整搜索条件。
Token 缺失时，提示用户在 `config.yaml` 中配置 `tools.cloud_mail.token`。
