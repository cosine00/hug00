---
title: Hugo 静态博客管理的姿势
author: 落落vici
date: "2026-07-31 10:32:29"
lastmod: "2026-07-31 11:18:44"
tags:
  - 折腾
slug: blog-manage
draft: false
---

2023 年年初开始瞎捣鼓这个 [hugo博客](https://hux.ink/posts/hello-hugo/)，写文经历了四个阶段。

- **1.0原始时代** 直接登录 GitHub 网页，在仓库里通过 Add file 新建文件、敲字、提交，最原始但也最直接。

- **2.0独立建库** 用上了Obsidian，作为一个单独库，[在Obsidian中写Hugo博客发布](https://hux.ink/posts/%E5%9C%A8obsidian%E4%B8%AD%E5%86%99hugo%E5%8D%9A%E5%AE%A2%E5%8F%91%E5%B8%83/)。

- **3.0融合统一** Obsidian 不将仓库单独管理了，直接在日常笔记库中合二为一，[Obsidian 自动同步到 Hugo](https://hux.ink/posts/obsidianpushtohugo/)。

- **4.0云端工作流** 通过 Notion 管理，在 Notion 中建立专门的 Database，再通过 GitHub Actions 自动转换为 Markdown 存储到仓库指定目录。

最近下班后跟娃一起跳绳，加上开了 Apple Fitness+，多了一些碎片化的运动记录。我尝试把这些数据叠加到[悦动](https://hux.ink/exercise/)页面，和跑步、骑行放在一起展示。然而，跑步和骑行能靠中转自动同步，没有轨迹的跳绳、HIIT、爬楼梯只能手动录入。

我的第一反应依然是路径依赖——继续用 Notion 管理！于是迅速建好了运动记录 Database，也顺利打通了 GitHub Actions。

但转念一想：万一哪天 Notion 宕机/受限，或者自动化链路断了，我是不是又得倒退回原始时代？

思来想去，决定彻底摆脱对第三方平台的依赖，自己折腾一个专属的静态博客管理后台。花了一两天的闲余时间，终于跑通并成型可用。

没啥审美，浓浓的 AI 工业风，但功能上满足我当前的需求了。文章管理、评论互动、RSS订阅、运动记录、足迹记录、图床管理都集成在一处了。

虽然粗糙，但踏实了。


![hugo01](https://img.hux.ink/image/2026/07/20260730174951-8mvdq-hugo01.webp)

![hugo02](https://img.hux.ink/image/2026/07/20260730174953-z5ofa-hugo02.webp)

![hugo03](https://img.hux.ink/image/2026/07/20260730174955-6lhoq-hugo03.webp)

![hugo04](https://img.hux.ink/image/2026/07/20260730174957-wmp95-hugo04.webp)

![hugo05](https://img.hux.ink/image/2026/07/20260730174959-ynn9k-hugo05.webp)

![hugo06](https://img.hux.ink/image/2026/07/20260730175001-qfg1v-hugo06.webp)

![hugo07](https://img.hux.ink/image/2026/07/20260730175003-jugtp-hugo07.webp)

![hugo08](https://img.hux.ink/image/2026/07/20260730175005-4durd-hugo08.webp)

![hugo09](https://img.hux.ink/image/2026/07/20260730175006-jofn5-hugo09.webp)

![hugo10](https://img.hux.ink/image/2026/07/20260730175008-eg1m5-hugo10.webp)

![hugo11](https://img.hux.ink/image/2026/07/20260730175010-qwk5u-hugo11.webp)


❤