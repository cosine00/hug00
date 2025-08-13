---
title: 在Obsidian中写Hugo博客发布
author: 落落vici
tags:
  - 折腾
date: 2023-04-02 17:45:06
draft: false
hideInList: false
isTop: false
feature:
---

花了很长时间在设置 Obsidian Git 插件上，原来插件本身不用怎么设置，它只是调用系统 Git 程序的权限，生效的前提是使用系统 Git 程序连接到自己的 Github，然后将本地文件夹（Obsidian 库文件）连接到 Github 远程仓库。在连接之前，Obsidian Git 插件设置页面会显示“Git is not ready. When all settings are correct you can configure auto backup, etc.”。两项连接成功之后，重新进入 Obsidian Git 插件设置页面，上述 not ready 的提示字符会消失，说明配置成功。

### Git 连接 Github

1. 在cmd窗口中输入

git config --global user.name "your name"    //github 用户名

git config --global user.email "your@email.com"    //github 注册邮箱

2. 创建 SSHkey

ssh-keygen -t rsa -C "your@email.com" //github 注册邮箱

3. 连续敲三次回车键

4. 在本地用户文件夹（登录用户名）下会生成 .ssh文件夹，里面包含 id_rsa 和id_rsa.pub两个文件

5. 用记事本打开 id_rsa.pub，复制里面的内容

6. Github 官网登录，个人账户-Settings进入，选择 SSH and GPG keys 项目，点击 New SSH key 创建新 key ，标题 title 随便输入，在 Key 栏目下将刚刚复制的内容粘入，添加。

7. 回到命令窗口输入 ssh -T git@github.com 输入 yes，出现 successfully 就成功了。

### Clone Github 远程仓库到本地

选择一个希望存放仓库的文件夹，右键菜单选择命令"Git Bash Here",在打开的 Git 窗口中，输入指令 git clone ssh   (ssh 替换为从 github 项目仓库 code 路径下复制的 SSH 链接)
clone过程中多次报错，好像是网络代理的原因，尝试换节点或把梯子撤掉。

### Obsidian 配置

用 Obsidian 打开新的本地仓库，打开路径选择刚刚 clone 到本地的文件夹。

在插件市场安装 Obsidian Git、Templater、Quickadd 三个插件，安装后分别启用

1. Obsidian Git  
在前面两步操作完之后，Obsidian Git 启用后应该是自动将本地库连接到了远程仓库，打开设置，将 Vault backup interval (minutes)设置为 3 分钟，同时打开 Auto Backup after file change

2. 库根目录新建一个 _Templates 的文件夹用于存在模板文件，新建一个模板。

3. Quickadd 设置用这个模板新建文件，新创建的文件自动存入 content/posts 目录下

至此设置完成。库中文档如有变动，三分钟之后会自动提交 push 到 Github 远程仓库，因为将仓库源码部署在了 Vercel 中，Vercel 监测到仓库代码变动，会自动 deploy。

也即实现了在 obsidian 中新建一个 md 文档，编写完成后约 3 分钟后就可以在前端博客页面看到渲染后的博客新文章。当然如果三分钟都不想等待，可以通过命令手动执行，打开 Obsidian 命令面板，找到 Obsidian Git: commit all changes 命令执行，然后再找到 Obsidian Git: push 命令执行。手动执行成功后，文档变动就推送到远程仓库中了，等几秒钟 Vercel 自动部署就好了。

这些文字在 obsidian 中敲下。

试试看成功没？✨


### 参考
- 木木木木木  [Hugo With Obsidian](https://immmmm.com/hugo-with-obsidian/)
- 莉莉安 [obsidian 配合 hugo、cloudflare：让发布博客简单到不可思议](https://lillianwho.com/posts/obsidian-hugo-cloudflare/)


❤