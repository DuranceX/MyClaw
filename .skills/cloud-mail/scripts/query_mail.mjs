#!/usr/bin/env node
/**
 * cloud-mail 邮件查询脚本
 *
 * 通过 cloud-mail API 查询邮件列表，支持多种过滤条件。
 * Token 从环境变量 CLOUD_MAIL_TOKEN 读取（由调用方注入，通常来自 config.yaml）。
 *
 * 用法：CLOUD_MAIL_TOKEN=xxx node query_mail.mjs [options]
 */

// ── 解析命令行参数 ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const params = {};

for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, "");
  const val = args[i + 1];
  if (args[i].startsWith("--") && val && !val.startsWith("--")) {
    params[key] = val;
    i++;
  }
}

// ── 校验 Token ────────────────────────────────────────────────────────────────
const token = process.env.CLOUD_MAIL_TOKEN;
if (!token) {
  console.error("❌ 缺少 CLOUD_MAIL_TOKEN，请在 config.yaml 中配置：");
  console.error("   CLOUD_MAIL_TOKEN=your-token-here");
  process.exit(1);
}

// ── 构造请求体 ────────────────────────────────────────────────────────────────
const body = {};
if (params.toEmail)   body.toEmail   = params.toEmail;
if (params.sendName)  body.sendName  = params.sendName;
if (params.sendEmail) body.sendEmail = params.sendEmail;
if (params.subject)   body.subject   = params.subject;
if (params.content)   body.content   = params.content;
if (params.timeSort)  body.timeSort  = params.timeSort;   // asc | desc
if (params.type !== undefined) body.type = Number(params.type);   // 0=收件 1=发件
if (params.isDel !== undefined) body.isDel = Number(params.isDel);
if (params.num)  body.num  = Number(params.num);
if (params.size) body.size = Number(params.size);
if (params.startTime) body.startTime = params.startTime;  // 格式：YYYY-MM-DD HH:mm:ss
if (params.endTime)   body.endTime   = params.endTime;

// ── 执行主逻辑 ───────────────────────────────────────────────────────────────
(async () => {
  const BASE_URL = "https://mail.starnight.top";

  try {
    const res = await fetch(`${BASE_URL}/api/public/emailList`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();

    if (json.code !== 200) {
      console.error(`❌ API 返回错误 [${json.code}]：${json.message}`);
      process.exit(1);
    }

    let emails = json.data ?? [];

    if (emails.length === 0) {
      console.log("📭 未找到符合条件的邮件");
      process.exit(0);
    }

    // ── 格式化输出 ──────────────────────────────────────────────────────────────
    console.log(`📬 共找到 ${emails.length} 封邮件`);
    console.log("─".repeat(50));

    for (let i = 0; i < emails.length; i++) {
      const m = emails[i];
      const typeLabel = m.type === 0 ? "收件" : "发件";
      const delLabel  = m.isDel === 0 ? "" : " [已删除]";

      console.log(`[${i + 1}] ${typeLabel}${delLabel}`);
      console.log(`    来自：${m.sendName} <${m.sendEmail}>`);
      console.log(`    收件人： <${m.toEmail}>`);  // 简化收件人显示，兼容不同数据结构
      console.log(`    主题：${m.subject}`);
      console.log(`    时间：${m.createTime} (UTC)`);

      // 输出完整邮件内容（技能设计修改：取消所有截断逻辑）
      // 优先使用纯文本字段 m.text；若无则从 HTML 清理后输出完整正文
      let fullContent = m.text || "";
      if (!fullContent && m.content) {
        fullContent = m.content
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/?(p|div|h[1-6])[^>]*>/gi, "\n\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      if (fullContent) {
        console.log(`    内容：`);
        console.log(fullContent);
        console.log("\n" + "─".repeat(30) + " 完整内容结束 " + "─".repeat(30));
      } else {
        console.log(`    内容：（无正文）`);
      }

      if (i < emails.length - 1) console.log("");
    }

    console.log("─".repeat(50));
    process.exit(0);  // 显式正常退出，避免 core dump
  } catch (err) {
    console.error("❌ 请求失败：", err.message);
    process.exit(1);
  }
})();
