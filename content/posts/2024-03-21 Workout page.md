---
title: Workout page
date: 2024-03-20 16:30:08
tags:
  - 折腾
  - 人间流浪
author: 落落vici
draft: false
slug: workoutpage
hideInList: false
isTop: false
feature:
---
昨天将 [running page](https://run.hux.ink) 跑步页面改为了 [workout page](https://workout.hux.ink) 锻炼页面，支持更多运动类型。

以前只有跑步数据的时候很想参照 [yihong0618](https://github.com/yihong0618) 大神的[running_page](https://github.com/yihong0618/running_page)同步一个自己的跑步页面，经过几番折腾，于去年11月份上线 。刚上线的时候，因为 Nike 的refresh_token 获取不到，没办法完整同步，只有从开启 Nike 连接 Strava 之后的新数据，当时还觉得有些可惜。但后面通过一个第三方 app 将 Nike run club 的历史数据全部同步到 Strava 了，再手动删除了2019年及之前年份的，算是完美了。

今年春节后，体重上升势头压不住，体检血压高，于是上下班通勤改骑自行车，周末偶尔去爬个山，就这样多了两种运动类型。以前有留意过另一位大神 [ben-29](https://github.com/ben-29) 在跑步页面基础上改造的 [workouts_page](https://github.com/ben-29/workouts_page) ，不仅有跑步，还支持徒步、骑行，甚至是游泳。于是尝试用以前相同的办法，将数据搬上去，升级一下锻炼页面。

简单再记录一下操作步骤：
1. 登录 Github，Fork 仓库 [workouts_page](https://github.com/ben-29/workouts_page) 。
2. 修改.github/workflow目录下的run_data_sync.yml文件，下图这部分内容按需修改为自己的，RUN_TYPE 字段对应你想同步的数据跑步应用来源。

![workout page01.png](https://img.hux.ink/image/2024/03/workout%20page01.png)

3. 按照[获取 Strava 数据](https://github.com/yihong0618/running_page/blob/master/README-CN.md#strava)的操作步骤，依次获取「STRAVA_CLIENT_ID」、「STRAVA_CLIENT_SECRET」和「STRAVA_CLIENT_REFRESH_TOKEN」三项内容，然后进入仓库的「Settings」>「Security」>「Secrets and variables」>「Actions」，选择底部的「New repository secret」，将上述三项字段和已获取的值分别填写在此处。

![workout page02.png](https://img.hux.ink/image/2024/03/workout%20page02.png)

4. 将仓库中已有的数据文件删除，分别删除以下路径文件：\assets(里面带年份的文件)、\run_page\data.db 、\src\static\activities.json。
5. 删除完毕后进入仓库的「Actions」>「Run Data Sync」>「Run workflow」执行数据同步。执行完返回刚刚删除数据文件的路径下，可以看到新同步的数据文件已经产生。
6. 将项目部署到 Vercel 或 Github Page。

而后，页面就生成了，再将域名自定义一下。

![workout page03.png](https://img.hux.ink/image/2024/03/workout%20page03.png)

最后，Yesterday You Said Tomorrow，动起来。

❤