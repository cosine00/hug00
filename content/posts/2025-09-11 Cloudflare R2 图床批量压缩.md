---
title: Cloudflare R2 图床批量压缩
date: 2025-09-11 10:45:40
tags:
  - 折腾
author: 落落vici
draft: false
slug: pic-compress
hideInList: false
isTop: false
feature:
---
[$哥]( https://synyan.cn/ )前几日留言说我这流量真豪横，图片用 png，一张5mb……

我的图片放在 Cloudflare R2 上，因为不按流量计费，所以一直没太关心，写文章的时候用 PicGo 原图上传。

[LM$哥]( https://lms.im/ )留言说图片加载不友好，都显示 image.png 。

确实，虽然流量不花钱，但图片大小会影响页面加载速度。我觉得有必要将 Cloudflare 上的图片重新压缩整理一番，并且后续的新图片在上传前先进行压缩。

首先是已上传到 R2 旧图片的重新压缩，步骤是将 R2 对象存储中的图片下载到本地，用图片压缩工作将图片本地压缩，然后将压缩后的图片重新上传至 R2 对象存储替换原图。

思路很简单，但肯定不能一张一张搞。费了一番功夫找教程、找工具。用到了 [Rclone](https://downloads.rclone.org/v1.63.0/) 和 [Imagine](https://github.com/meowtec/Imagine) 这两个工具，Rclone 用来批量下载 Cloudflare R2 的已有图片并将压缩后的图片回传，Imagine 用来批量压缩本地图片。

Rclone 要用[命令行]( https://rclone.cn/commands/rclone_config/ )，这又难倒了我，边问豆包边操作，干中学。
- 1. 首先是用 rclone config 命令进行交互式配置创建 rclone.conf，按照提示选择操作，配置时需要用到 Cloundflare R2 的 `access_key_id，secret_access_key，endpoint` 三个参数，配置好的 rclone.conf 内容如图。

![R2.png](https://img.hux.ink/image/2025/09/20250911115344808.png)

- 2. 新建批处理指令，写入代码，将后缀改为 `.bat`（双击运行），将图片下载到本地。

```
@echo off
cd /d D:\rclone-v1.63.0-windows-amd64
rclone sync r2:image/image/2025 D:/Cloudflare/2025 --ignore-existing -u -v -P --transfers=20 --ignore-errors --buffer-size=128M --check-first --checkers=10 --drive-acknowledge-abuse
pause
```

- 3. 安装图片压缩工具 Imagine，对下载到的本地图片批量压缩，保存并覆盖原图，保持原文件名不变。

![Imagine compress.png](https://img.hux.ink/image/2025/09/20250911135318511.png)

- 4. 反向操作，通过批处理指令将压缩后的图片上传回 Cloudflare R2，替换原文件。

```
@echo off
cd /d D:\rclone-v1.63.0-windows-amd64
rclone sync D:/Cloudflare/2025 r2:image/image/2025 -u -v -P --transfers=20 --ignore-errors --buffer-size=128M --check-first --checkers=10 --drive-acknowledge-abuse
pause
```

操作完登录 Cloudflare，可以看到在 R2 存储桶中的文件已经完成更新。

至于后续新的图片，在 PicGo 中安装了 tinypng 插件，上传前先压缩一遍。

应该可以将加载速度提升一秒吧。🙃

❤