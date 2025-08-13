---
title: Obsidian 自动同步到 Hugo
date: 2024-03-27 17:17:04
tags:
  - 折腾
author: 落落vici
draft: false
slug: obsidianpushtohugo
hideInList: false
isTop: false
feature:
---
虽然用 Obsidian 写 Hugo 博客简单易用，但博客目录作为一个单独的库，每次想写些文字都要单独切换至博客目录下，多一步操作，前一秒想写，等切换完成，下一秒很可能就要放弃了。

我的日常使用是 Obsidian 和 Logseq 共用一个库，取两个应用的长处，Obsidian 用来记录长文和使用 Canvas，Logseq 用来记录 daily note，产生的文件通过 OneDrive 在 Win 和 Mac 之间同步，同时通过 Git 插件备份到 Github 仓库。iOS 下通过 Working copy 这个 app 拉取仓库内容，设置好自动化（打开 Logseq app 的时候自动 Pull），移动端只 Pull 后查看，不记录并 Push。

同时我还有一个剪藏文章的库—— [简悦花园]( https://clip.hux.ink/ )，也托管在 Github 上，偶尔打开添加剪辑文章也要切换到项目本地库。

其实三个库都是相同的操作，本地库写完，Git Push 到 Github。本地三个库，对应 Github 三个 Repo。于是想着能否在日常 Obsidian 主库里面再添加两个文件夹，在主库里面直接写，git push 后，自动根据文件夹目录分别同步到 Hugo 博客、剪辑文章各自 Repo 的指定路径下，这样 Obsidian 日常就只需要在同一个库中操作了。

Google 一搜，早有大神这样干了，不过大多是同步到 Hexo。原理一致嘛，于是照着 [obsidian-hexo-blog](https://github.com/winniesi/obsidian-hexo-blog) 这篇教程，设置并测试。首次执行，发现新文章是同步过去了，但是 Hugo 目录下旧文章全给删除了。回头检查一下代码，发现有一段是“删除已有的 Markdown 文件”，不知原作者为何加这段。把这段代码删除，然后重新测试一遍，成功跑通。

这篇文字即在 Obsidian 主库中写下，完结撒花，感谢[winniesi](https://github.com/winniesi)🎉


❤