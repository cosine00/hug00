---
title: 在Obsidian中写Hugo博客发布
author: 落落vici
tags:
  - Log
date: 2023-04-02 17:45:06
draft: false
hideInList: false
isTop: false
feature:
---
在Obsidian中写Hugo博客发布

花了很长时间在设置Obsidian Git插件上，原来插件本身不用怎么设置，它只是调用系统Git程序的权限，生效的前提是使用系统Git程序连接到自己的Github，然后将本地文件夹（Obsidian库文件）连接到Github远程仓库。在连接之前，Obsidian Git插件设置页面会显示“Git is not ready. When all settings are correct you can configure auto backup, etc.”。两项连接成功之后，重新进入Obsidian Git插件设置页面，上述not ready的提示字符会消失，说明配置成功。

### Git连接Github

1. 在cmd窗口中输入

git config --global user.name "your name"    //github用户名

git config --global user.email "your@email.com"    //github注册邮箱

2. 创建SSHkey

ssh-keygen -t rsa -C "your@email.com" //github注册邮箱

3. 连续敲三次回车键

4. 在本地用户文件夹（登录用户名）下会生成 .ssh文件夹，里面包含 id_rsa 和id_rsa.pub两个文件

5. 用记事本打开id_rsa.pub，复制里面的内容

6. Github官网登录，个人账户-Settings进入，选择SSH and GPG keys项目，点击New SSH key创建新key，标题title随便输入，在Key栏目下将刚刚复制的内容粘入，添加。

7. 回到命令窗口输入ssh -T git@github.com 输入yes，出现successfully就成功了。

### Clone Github远程仓库到本地

选择一个希望存放仓库的文件夹，右键菜单选择命令"Git Bash Here",在打开的Git窗口中，输入指令 git clone ssh   (ssh替换为从github项目仓库code路径下复制的SSH链接)
clone过程中多次报错，好像是网络代理的原因，尝试换节点或把梯子撤掉。

### Obsidian 配置

用Obsidian打开新的本地仓库，打开路径选择刚刚clone到本地的文件夹。

在插件市场安装Obsidian Git、Templater、Quickadd三个插件，安装后分别启用

1. Obsidian Git  
在前面两步操作完之后，Obsidian Git 启用后应该是自动将本地库连接到了远程仓库，打开设置，将Vault backup interval (minutes)设置为3分钟，同时打开Auto Backup after file change

2. 库根目录新建一个_Templates的文件夹用于存在模板文件，新建一个模板。

3. Quickadd设置用这个模板新建文件，新创建的文件自动存入content/posts目录下

至此设置完成。库中文档如有变动，三分钟之后会自动提交push到Github远程仓库，因为将仓库源码部署在了Vercel中，Vercel监测到仓库代码变动，会自动deploy。

也即实现了在obsidian中新建一个md文档，编写完成后约3分钟后就可以在前端博客页面看到渲染后的博客新文章。当然如果三分钟都不想等待，可以通过命令手动执行，打开Obsidian命令面板，找到Obsidian Git: commit all changes命令执行，然后再找到Obsidian Git: push命令执行。手动执行成功后，文档变动就推送到远程仓库中了，等几秒钟Vercel自动部署就好了。

这些文字在obsidian中敲下。

试试看成功没？✨


### 参考
- 木木木木木  [Hugo With Obsidian](https://immmmm.com/hugo-with-obsidian/)
- 莉莉安 [obsidian 配合 hugo、cloudflare：让发布博客简单到不可思议](https://lillianwho.com/posts/obsidian-hugo-cloudflare/)


❤