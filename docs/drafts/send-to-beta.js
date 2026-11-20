/**
 * 发送到 Beta —— Drafts Action 脚本（Drafts 5 / iOS）
 *
 * 把当前文稿发到 hux.ink/beta 的云端草稿箱：
 *   第一行 = 标题（`# 标题` 这种会去掉井号），其余 = Markdown 正文。
 * 只发不删：原文一个字都不动，也不归档、不跳浏览器。
 *
 * 注意：Drafts 的 Script 步骤是把代码当「脚本」直接执行，不会包进函数。
 * 所以下面整段套在一个 IIFE 里 —— 否则顶层的 return 会直接报
 * 「Return statements are only valid inside functions」。
 *
 * 装法见 docs/drafts-to-beta.md。令牌存在 Drafts 的 Credential 里，
 * 不写进这段代码，也不出现在任何导出文件里。
 */

(function () {
  "use strict";

  const ENDPOINT = "https://comments.hux.ink/api/integrations/drafts";
  const TITLE_LIMIT = 300;

  /* ------------------------------- 拿令牌 ------------------------------- */

  const cred = Credential.create("Beta 草稿箱", "hux.ink/beta 的集成令牌");
  cred.addPasswordField("token", "集成令牌");
  if (!cred.authorize()) {
    context.fail("没有拿到 Beta 令牌，这次没发出去。");
    return;
  }
  const token = cred.getValue("token");
  if (!token) {
    context.fail("令牌是空的：重新运行 Action，把 Worker Secret 里那串填进去。");
    return;
  }

  /* ------------------------------ 拆标题正文 ----------------------------- */

  // Drafts 里粘贴来的文本常带行尾空白和 \r\n，先统一掉再拆
  const lines = String(draft.content || "").replace(/\r\n?/g, "\n").split("\n");

  let at = 0;
  while (at < lines.length && !lines[at].trim()) at += 1; // 跳过开头空行

  if (at >= lines.length) {
    context.fail("这篇是空的，没什么可发的。");
    return;
  }

  const firstLine = lines[at].trim();
  // 只有「# 空格 文字」才算 Markdown 标题；`#标签` 这种不算，别把话题标签吃掉
  const title = /^#{1,6}\s+/.test(firstLine)
    ? firstLine.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim()
    : firstLine;

  if (!title) {
    context.fail("第一行是空的标题，补一句再发。");
    return;
  }
  if (title.length > TITLE_LIMIT) {
    context.fail(
      "第一行有 " + title.length + " 字，超过 " + TITLE_LIMIT + " 字的标题上限。"
      + "可以在第一行单独写一行短标题（例如 # 在雨里走了一段路），正文从第二行开始。"
    );
    return;
  }

  // 标题之后的都算正文；去掉紧跟着的空行和结尾空白，其余原样保留
  const body = lines.slice(at + 1).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");

  /* -------------------------------- 发送 -------------------------------- */

  const http = HTTP.create();
  let response = null;
  try {
    response = http.request({
      url: ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        source: "drafts",
        sourceId: draft.uuid,
        title: title,
        body: body
      }),
      timeout: 30,
      responseType: "json"
    });
  } catch (error) {
    // 断网、DNS、超时都会走到这里；草稿没动，重试是安全的
    context.fail("连不上 Beta（" + error.message + "）。草稿原文没动，网络好了再点一次。");
    return;
  }

  const status = Number((response && response.statusCode) || 0);
  let payload = response ? response.responseData : null;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      payload = null;
    }
  }
  const serverText = payload && payload.error && payload.error.message ? payload.error.message : "";

  /* ------------------------------- 看结果 ------------------------------- */

  if (!status) {
    context.fail("没收到 Beta 的回应（可能断网或超时）。草稿原文没动，稍后再试一次。");
    return;
  }

  if (status === 200 || status === 201) {
    const state = payload && payload.status;
    if (state === "created") {
      app.displaySuccessMessage("已发送到 Beta");
    } else if (state === "updated") {
      app.displaySuccessMessage("已更新 Beta 里的草稿");
    } else if (state === "unchanged") {
      app.displaySuccessMessage("Beta 里已是最新，没有重复创建");
    } else {
      app.displaySuccessMessage("已发送到 Beta");
    }
    return;
  }

  if (status === 401) {
    context.fail("令牌不对（401）。" + (serverText || "检查 Drafts 里存的令牌是否和 Worker Secret 一致。"));
    return;
  }

  if (status === 409) {
    const conflict = payload && payload.conflict;
    const betaTitle = conflict && conflict.beta ? conflict.beta.title : "";
    const hint = conflict && conflict.hint ? conflict.hint : "";
    context.fail(
      (serverText || "这次没有写入（409）。")
      + (betaTitle ? "\n\nBeta 里的版本：《" + betaTitle + "》" : "")
      + (hint ? "\n" + hint : "")
    );
    return;
  }

  if (status === 413) {
    context.fail(serverText || "这篇太长了（413），Beta 单篇草稿装不下。");
    return;
  }

  if (status === 429) {
    const wait = payload && payload.retryAfter ? " 约 " + payload.retryAfter + " 秒后再试。" : "";
    context.fail(serverText || ("发得太勤了（429）。" + wait));
    return;
  }

  if (status === 400) {
    context.fail(serverText || "Beta 说这份内容不合要求（400）。");
    return;
  }

  if (status >= 500) {
    context.fail("Beta 服务端出问题了（" + status + "）。" + (serverText || "稍后再试，草稿原文没动。"));
    return;
  }

  context.fail("发送失败（" + status + "）。" + (serverText || ""));
})();
