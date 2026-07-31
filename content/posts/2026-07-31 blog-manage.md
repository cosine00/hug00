---
title: Hugo 静态博客管理的姿势
author: 落落vici
date: "2026-07-31 10:32:29"
lastmod: "2026-07-31 10:50:58"
tags:
  - 折腾
slug: blog-manage
draft: true
---

2023 年年初开始瞎捣鼓这个 [hugo博客](https://hux.ink/posts/hello-hugo/)，写文经历了几个阶段。

- 1.0 最初写文章是通过登录 Github 网页，到仓库中通过 Add file 这种最原始的方式新建文件敲字提交。

- 2.0 而后用上了Obsidian，作为一个单独库，[在Obsidian中写Hugo博客发布](https://hux.ink/posts/%E5%9C%A8obsidian%E4%B8%AD%E5%86%99hugo%E5%8D%9A%E5%AE%A2%E5%8F%91%E5%B8%83/)。

- 3.0 Obsidian 不将仓库单独管理了，直接在日常笔记库中合二为一，[Obsidian 自动同步到 Hugo](https://hux.ink/posts/obsidianpushtohugo/)。

- 4.0 通过 Notion 管理，在 Notion 中建立一个数据库，然后通过 Github Action 转换成 Markdown 文件保存到仓库指定目录中。

最近下班后跟娃一起跳绳，另外开了 Apple Fitness+，有一些碎片化运动记录，我叠加在[悦动](https://hux.ink/exercise/)中与跑步、骑行等一起显示。但跑步、骑行可以通过中转自动更新，而没有轨迹的跳绳、HIIT、爬楼梯等运动只能手动新增。我一开始想到的也是像写文章一样通过 Notion 进行管理维护，路径依赖症。的确，在 Notion 中新建了一个运动记录 database，也跟 GitHub 顺利打通了。

但转念一想，万一哪天 Notion 无法使用了，或者自动化这条路被堵死了，岂不是又得回到原始时代？

于是下决心折腾一个管理后台，摆脱第三方依赖，花了一两天时间，成型可用。

没啥审美，浓浓的 AI 风，但功能上满足我当前的需求了。文章管理、评论互动、RSS订阅、运动记录、足迹记录、图床管理都集成在一处了。


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