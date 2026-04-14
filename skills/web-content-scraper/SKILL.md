---
name: web-content-scraper
description: 网页文章剪藏工作流。当用户提供链接并要求抓取文章内容保存到 Obsidian 时触发（如"抓取这篇文章保存到 Obsidian"、"把这个链接的内容存到笔记里"、"剪藏这篇文章"）。完整流程：Playwright 访问页面 → 解析正文和图片 → 保存为 Obsidian 笔记。注意：如果用户只是想"读取一个链接"或"看看这个网页写了什么"，不应触发本 skill，应使用 WebFetch 或 defuddle 等工具。本 skill 仅在用户明确要求将文章内容持久化保存时触发。
---

# Web Content Scraper

网页文章剪藏工作流：抓取页面（WebFetch 优先，Playwright 降级）→ 解析正文和图片 → 保存到 Obsidian。

## 支持的平台

| 平台 | 域名 | 状态 |
|------|------|------|
| 小黑盒 | xiaoheihe.cn | ✅ 支持 |
| （预留）| - | 🔜 待扩展 |

---

## 工作流程

### 第一步：识别平台

根据链接域名判断平台，选择对应的抓取策略（见下方各平台章节）。

如果链接不属于任何已支持平台，使用通用策略（见"通用策略"章节）。

### 第二步：抓取页面内容

优先使用轻量方式，失败时再降级：

1. **首选：WebFetch / defuddle** — 直接请求 URL 获取页面内容。如果能拿到完整的正文文本，则直接使用，跳过 Playwright。
2. **降级：Playwright** — 当 WebFetch 返回内容为空、明显不完整（如只有导航栏/页脚、缺少正文）、或页面是纯 JS 渲染的动态页面时，使用 `mcp__plugin_playwright_playwright__browser_navigate` 导航到链接，再用 `mcp__plugin_playwright_playwright__browser_evaluate` 执行 JS 提取内容。

判断 WebFetch 结果是否可用的标准：
- 正文文本长度合理（不是只有几行导航文字）
- 包含文章标题和正文段落
- 如果只拿到了 HTML 框架或 "请启用 JavaScript" 之类的提示，说明需要 Playwright

### 第三步：提取正文内容

按平台策略提取正文文本，转换为 Markdown 格式。

**重要：正文必须原封不动保存，不得改写、总结、润色或重新排版。提取到什么就保存什么。**

### 第四步：提取图片并记录位置

用 JS 提取页面中文章正文区域的图片 URL，过滤掉头像、图标、广告等无关图片。

同时记录每张图片在正文中的相对位置（出现在哪段文字之后），以便在保存笔记时将图片嵌入到正文对应位置，而不是统一附在末尾。

### 第五步：保存到 Obsidian

将正文和图片保存到 Obsidian vault（见"保存到 Obsidian"章节）。

---

## 小黑盒（xiaoheihe.cn）

### 识别规则

URL 包含 `xiaoheihe.cn` 或 `heihe.cn`。

小黑盒为纯 JS 渲染的动态页面，WebFetch 无法获取正文，直接使用 Playwright。

### 正文提取

```javascript
// 提取正文文本（原样提取，不做任何改动）
() => document.body.innerText
```

正文通常在页面主体区域，包含标题、作者、发布时间、正文段落。

**提取原则：原封不动保存原文，不得改写、总结、润色或重新排版。**

### 图片位置记录

提取图片时，需同时记录每张图片在 DOM 中的位置，以便将图片嵌入到正文对应段落之后：

```javascript
// 提取正文图片及其在文章中的顺序位置
() => {
  const imgs = Array.from(document.querySelectorAll('img'))
    .filter(img =>
      img.src.includes('/web/bbs/') &&
      !img.src.includes('/avatar/') &&
      !img.src.includes('thumbnail/100x100')
    );
  return imgs.map((img, i) => {
    // 找到图片前最近的文本节点内容，用于定位插入点
    let prev = img.previousElementSibling;
    const prevText = prev ? prev.innerText?.trim().slice(0, 30) : '';
    return { index: i + 1, src: img.src, prevText };
  });
}
```

保存笔记时，将图片 `![[文件名]]` 插入到对应段落之后，而不是统一附在文末。

### 图片过滤规则

文章正文图片的 URL 特征：
- 包含 `/web/bbs/` 路径（正文配图）

需要过滤掉的图片：
- 包含 `/avatar/` 或 `avatar` 参数（用户头像）
- 包含 `/oa/` 路径（运营图标/徽章）
- 包含 `thumbnail/100x100` 参数（缩略头像）
- 来自 `cdn.max-c.com/heybox/dailynews/` （每日新闻图）
- 来自 `cdn.max-c.com/pc_game/` 或 `mobile/app/icon/`（游戏/应用图标）

```javascript
// 提取文章正文图片
() => Array.from(document.querySelectorAll('img'))
  .map(img => img.src)
  .filter(src =>
    src.includes('/web/bbs/') &&
    !src.includes('/avatar/') &&
    !src.includes('thumbnail/100x100')
  )
```

### 图片 URL 清理

小黑盒图片 URL 末尾带有 CDN 处理参数（如 `?imageMogr2/format/webp/quality/50`），下载时去掉参数可获得原图：

```
https://imgheybox.max-c.com/web/bbs/2026/04/04/xxx/thumb.png   ← 原图
```

---

## 通用策略（未知平台）

1. 导航到页面
2. 尝试用 `document.body.innerText` 提取全文
3. 提取所有 `<img>` 标签的 `src`，让用户确认哪些是文章正文图片
4. 按用户确认结果保存图片

---

## 保存到 Obsidian

当抓取和解析完成后，执行以下流程将文章持久化保存到 Obsidian：

### Obsidian Vault 路径

Vault 根目录：`/Users/cardy/Library/CloudStorage/OneDrive-个人/Mine/Obsidian`

- 笔记保存目录：`Clippings/`
- 图片保存目录：`Attachment/`

### 保存流程

#### 1. 生成笔记文件名

格式：`<文章标题> - <平台名>.md`

- 文件名中不能包含 `/`、`\`、`:`、`|`、`?`、`*`、`<`、`>`、`"`，需替换为空格或删除
- 示例：`一次 Vibe Designing 实验 - 少数派.md`

#### 2. 下载文章图片到 Attachment

将文章正文中的图片下载到 `Attachment/` 目录：

```bash
# 文件名格式：文章标题缩写_序号.扩展名
curl -s -o "Attachment/<文章缩写>_01.png" "<图片URL>"
curl -s -o "Attachment/<文章缩写>_02.webp" "<图片URL>"
```

- 图片文件名使用文章标题的简短缩写（2-4个关键字拼音或英文）+ 序号，避免冲突
- 从 URL 中推断扩展名（`.png`、`.jpg`、`.webp`、`.gif`），如无法推断默认用 `.png`

#### 3. 创建 Markdown 笔记

笔记写入 `Clippings/<文件名>.md`，格式如下：

```markdown
---
title: "<文章标题>"
url: <原始URL>
author:
  - "[[作者名]]"
published: <发布日期，格式 YYYY-MM-DD，未知则留空>
created: <今天日期，格式 YYYY-MM-DD>
description: "<文章摘要或第一段，一句话>"
tags:
  - clippings
  - <根据内容添加 1-3 个相关标签>
---
<正文内容，Markdown 格式>
```

#### 4. 替换图片链接

正文中的外部图片链接 `![alt](url)` 替换为 Obsidian 内部嵌入格式：

```
![[<文章缩写>_01.png]]
```

#### 5. 完成确认

保存完成后告知用户：
- 笔记已保存到 `[[Clippings/<文件名>]]`
- 共保存了多少张图片到 `Attachment/`

### 注意事项

- 本 skill 是一个完整的剪藏工作流，保存到 Obsidian 是流程的固定终点，不是可选项
- 如果用户只是想"读取"或"看看"一个链接的内容，不应触发本 skill，应使用 WebFetch 或 defuddle
- frontmatter 中的 `author` 使用 `[[作者名]]` wikilink 格式，方便在 Obsidian 中关联
- `created` 字段使用当天日期
- `tags` 中始终包含 `clippings`，再根据文章内容智能添加 1-3 个相关标签

---

## 输出格式

抓取完成后，向用户展示：

1. **文章标题**
2. **作者 / 发布时间 / 平台**
3. **正文内容**（Markdown 格式）
4. **已保存图片列表**（如有）：文件名 + 原始 URL
5. **Obsidian 保存结果**（如执行了保存）：笔记路径 + 图片数量

---

## 扩展新平台

在"支持的平台"表格中添加新平台，并在本文件中新增对应章节，包含：
- 识别规则（域名特征）
- 正文提取方式（JS 选择器或 API）
- 图片过滤规则
- 特殊处理说明（如需登录、反爬等）
