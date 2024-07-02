---
title: Cloudflare 优化助力 Hugo
date: 2024-01-11 14:15:00
tags:
  - Log
  - 折腾
author: 落落vici
draft: false
slug: some-about-cloudflare
hideInList: false
isTop: false
feature:
---
这个 Hugo 博客自去年年初启用，到现在折腾近一年，最近用 Cloudflare 优化了一下，使用和访问速度都提升了不少。

### 将域名托管到 Cloudflare 进行解析

域名是在腾讯云购买的，注册域名时总想将名字和生日联系起来，试了很多组合都显示已被注册。无意间看到 .ink 尾缀的域名，我将姓名全拼在前面补全，显示可以注册，于是就有了 hux.ink 这个对我而言，既包含名字，又最简约的域名了。245元买了5年，2028年9月到期。看下是域名先到期还是我先弃用这个博客。

注册后一直使用腾讯云自家的 DNSPod 免费解析，现在托管到 Cloudflare 进行解析了。刚开始切换过去时，因为群晖原生 DDNS 没有 Cloudflare 服务，需要手动将服务添加进去。但配置好之后发现还是无法用域名访问群晖，折腾到很晚没解决。第二天删掉重新部署了一次，又可以正常访问了，不知道是哪一步的问题。

![cloudflare-01.png](https://img.hux.ink/image/2024/01/cloudflare-01.png)

### 开通R2存储桶作为图床使用

域名托管到 Cloudflare 之后，很多服务就可以用起来啦，首先是开通R2存储建立图床。之前博客文章里面的图片是上传到 Github 图床，但时不时因为网络原因上传失败，早想弃用。

Cloudflare R2 的开通需要先绑定信用卡，开通后参考大神的文章 [ PICGO+白嫖Cloudflare R2存储做图床](https://www.duangvps.com/archives/2015)，设置成功。

Obsidian 安装[image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin)插件，可以在 Obsidian 中粘贴图片自动上传到图床。

![cloudflare-02.png](https://img.hux.ink/image/2024/01/cloudflare-02.png)

![cloudflare-03.png](https://img.hux.ink/image/2024/01/cloudflare-03.png)

### 用 Cloudflare 去端口号

准确来说，其实不是去端口号，只是一个重新定向。需要两个子域名完成两个步骤设置：
- 在 Cloudflare DNS 记录页面，添加新的子域名 DNS 记录 CNAME 指向原有子域名，此处不用添加端口号，开启代理
- 从 Cloudflare 左侧的功能区进入 规则 - Origin Rules，添加一条规则，当匹配到新的子域名时重写到原有子域名的某个端口

利用这个方法就可以免记群晖各种服务的端口号了，比如搭在群晖里面的 Memos。

![cloudflare-04.png](https://img.hux.ink/image/2024/01/cloudflare-04.png)

![cloudflare-05.png](https://img.hux.ink/image/2024/01/cloudflare-05.png)

### 加速 Hugo 博客访问

- DNS 解析记录中，开启橙色小云朵代理，即开启了CDN，加速和保护流量。
- 缓存设置，将缓存级别设置为“忽略查询字符串”，浏览器缓存 TTL设置为5天或以上。
- 从左边栏 速度 - 优化 进入，启用所有可用设置。

这样一通操作下来，博客页面加载的确快了许多，以前 Memos 单页要转半天，现在几秒加载完毕。

![cloudflare-06.png](https://img.hux.ink/image/2024/01/cloudflare-06.png)

新年的第一回折腾，目前博客除了多图排版不如意（本来想应用木木老师的[Hugo 多图排版这样来](https://immmmm.com/about-images-gird/)，但不生效），其他都还好啦。建立这个博客记些流水账，只有域名是付费的，其他都是白嫖，夫复何求。

❤