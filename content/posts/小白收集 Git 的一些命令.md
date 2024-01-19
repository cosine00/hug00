---
title: "小白收集 Git 的一些命令"
date: "2024-01-19 09:35:32"
tags: 
author: 落落vici
draft: true
slug: 
hideInList: false
isTop: false
feature:
---
### Push 本地仓库到 Github
- 在GitHub上创建一个新的仓库
- 在当前项目的目录下，打开 Git Bash
- 将本地项目初始化为一个git仓库
```
git init
```
- 把文件添加进你的本地仓库，这作为你的第一次提交的状态
```
git add . (不要忘记 . 这表示当前目录下的所有文件)
```
- 提交本地文件到本地仓库
```
git commit -m "First commit"
```
- 复制Github上新建的远程仓库的URL
- 在命令提示框下，添加你的本地仓库想要推送到的远端仓库的URL
```
git remote add origin remote repository URL
```
- 将本地存储库中的更改推送到GitHub
```
git push origin master
```

### 切换 HTTPS 和 SSH 协议
- 查看当前remote
```
git remote -v
```
- 切换协议
```
git remote set-url origin 远程仓库链接
```

### 强制提交本地分支覆盖远程分支
```
git push origin master --force
```

❤