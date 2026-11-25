/*
Last Modified time : 20260511 by Gemini / Fixed Image Viewer Duplication
*/
let bbMemo = {
  memos: '/memos.json',
  limit: 10, 
  creatorId: '1',
  domId: '#bber',
  twiEnv: '' // 这里通常在 bb.html 的全局变量里配置
};

if (typeof(bbMemos) !== "undefined") {
  Object.assign(bbMemo, bbMemos);
}

function loadCssCode(code){
  let style = document.createElement('style');
  style.type = 'text/css';
  style.rel = 'stylesheet';
  style.appendChild(document.createTextNode(code));
  let head = document.getElementsByTagName('head')[0];
  head.appendChild(style);
}

const allCSS = `
#bber{margin-top:1rem;width:auto!important;min-height:100vh;}
.bb-timeline>ul{margin:0;padding:0;}
.bb-timeline>ul>li{margin-bottom:2rem;list-style-type:none;}
.bb-timeline .bb-item {
    border: none !important;
    border-bottom: 1px solid transparent !important;
    border-image: linear-gradient(
        to right,
        transparent,
        rgba(145,145,145,0.2),
        transparent
    ) 1 !important;
    border-radius: 0;
    box-shadow: none;
}

.bb-load button {
    border: 1px solid #dcdcdc;
    border-radius: 8px;
    box-shadow: 3px 3px 5px rgba(0,0,0,.1);
}
.bb-timeline .bb-item{padding:.6rem 1rem .6rem;font-size:16px;}
.bb-timeline .bb-info{position:relative;margin-top:.5rem;font-size:14px;}
.bb-timeline .datatime{font-size:15px;color:inherit;text-decoration:none;border-bottom:1px dotted transparent;transition:color .18s ease,border-color .18s ease;}
.bb-timeline a.datatime:hover{color:var(--accent,#42b983);border-bottom-color:currentColor;}
/* 底部右侧：表情 + 评论按钮，时间不再兼任入口 */
.bb-timeline .bb-foot-right{margin-left:auto;display:inline-flex;align-items:center;gap:.5rem;flex-wrap:nowrap;}
.bb-timeline .bb-cont{overflow-x:hidden;margin-top:.5rem;}
.bb-timeline .datacount{position:absolute;right:0;bottom:0;cursor:pointer;display:flex;align-items:center;color:#42b983;font-size:1em;background:none;border:none;outline:none;padding:0 6px;}
.bb-timeline .bb-cont img[src*=emotion]{display:inline-block;width:auto;}
.bb-timeline .bb-cont p{margin:0;min-height:18px;color:#3b3d42;letter-spacing:1px;line-height:28px;}
.tag-span{color:#42b983;font-weight:normal;background:transparent;border:1px solid rgba(66,185,131,0.4);border-radius:9999px;padding:0 10px;font-size:13px;display:inline-flex;align-items:center;justify-content:center;height:26px;box-sizing:border-box;margin-right:4px;}
.tag-span.tag-filter {cursor: pointer;text-decoration: underline;}
.loader {position: relative;margin:3rem auto;width: 100px;}
.circular {animation: rotate 2s linear infinite;height: 100%;transform-origin: center center;width: 100%;position: absolute;top: 0;bottom: 0;left: 0;right: 0;margin: auto;}
.path {stroke-dasharray: 1, 200;stroke-dashoffset: 0;animation: dash 1.5s ease-in-out infinite, color 6s ease-in-out infinite;stroke-linecap: round;}
@keyframes rotate {100% {transform: rotate(360deg);}}
@keyframes dash {0% {stroke-dasharray: 1, 200;stroke-dashoffset: 0;}50% {stroke-dasharray: 89, 200;stroke-dashoffset: -35px;}100% {stroke-dasharray: 89, 200;stroke-dashoffset: -124px;}}
.d-none {display: none !important;}
.bb-load {text-align: center;margin: 2em 0 1em 0;}
.bb-load button {background: #fff;color: #42b983;border: 1px solid #42b983;border-radius: 4px;padding: 8px 24px;font-size: 1em;cursor: pointer;}

/* 💬 极简气泡药丸胶囊 */
.comment-pill-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 2px 8px; /* display: none !important;修改为隐藏，!important 确保强制生效 不隐藏的时候改回 display: inline-flex;*/ 
  background: var(--pill-shell, var(--surface, #ffffff)); color: var(--muted, #555); border-radius: 14px;
  font-size: 13px; cursor: pointer; transition: all 0.2s;
  border: 1px solid var(--border, #e1e4e8); height: 26px; box-sizing: border-box;
  line-height: 1; vertical-align: middle; min-width: 26px;
}
.comment-pill-btn:hover { background: var(--pill-hover, #f6f8fa); border-color: var(--border-strong, #d1d5da); color: var(--accent-hover, #42b983); }
.dark-theme .comment-pill-btn { background: var(--pill-shell, #2d333b); color: var(--muted, #adbac7); border-color: var(--border, #444c56); }
/* --- 恢复正文内部 Markdown 列表的默认样式 --- */
.bb-timeline .bb-cont ul {
  list-style-type: disc; /* 恢复无序列表的圆点 */
  margin: 1em 0;         /* 恢复上下边距 */
  padding-left: 2em;     /* 恢复左侧缩进，让圆点显示出来 */
}

.bb-timeline .bb-cont ol {
  list-style-type: decimal; /* 恢复有序列表的数字 */
  margin: 1em 0;
  padding-left: 2em;
}

/* 覆盖掉外层 li 设定的 3rem 巨大下边距和无样式 */
.bb-timeline .bb-cont ul li,
.bb-timeline .bb-cont ol li {
  list-style-type: inherit; /* 继承父级的圆点或数字 */
  margin-bottom: 0.5em;     /* 把 3rem 改回正常的行距 */
}
  
/* --- 查看图片按钮：定制深蓝色 rgb(16, 66, 132) 药丸样式 --- */
.bb-timeline .attach-btn.comment-pill-btn {
  color: rgb(16, 66, 132); 
  border-color: rgba(16, 66, 132, 0.4); /* 半透明边框 */
}

.bb-timeline .attach-btn.comment-pill-btn:hover {
  background-color: rgba(16, 66, 132, 0.08); /* 悬停时显示极浅的深蓝色背景，不刺眼 */
  border-color: rgb(16, 66, 132);            /* 悬停时边框颜色加深 */
  color: rgb(16, 66, 132);            
}

/* ⚠️ 注意：暗色模式适配 
 * 因为 rgb(16, 66, 132) 在纯黑背景下会非常暗淡看不清。
 * 所以如果是暗色模式，建议依然保留之前那种高亮度的浅蓝色。
 */
.dark-theme .bb-timeline .attach-btn.comment-pill-btn {
  color: #58a6ff;
  border-color: rgba(88, 166, 255, 0.4);
}

/* Compact image entrance placed directly after memo content. */
.bb-cont:has(.bb-image-trigger){overflow:visible;}
.bb-image-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;margin:0;padding:0;border:0;background:transparent;color:var(--accent,var(--link-color,#42b983));font:inherit;line-height:1;vertical-align:-.12em;cursor:zoom-in;isolation:isolate;opacity:.82;transition:color .18s ease,opacity .18s ease,transform .18s ease;}
.bb-image-trigger svg{display:block;width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.bb-image-trigger:hover,.bb-image-trigger:focus-visible{color:var(--accent-hover,var(--accent,#42b983));opacity:1;transform:translateY(-1px);}
.bb-image-trigger:focus-visible{outline:1px solid currentColor;outline-offset:2px;border-radius:2px;}
/* 「+N」角标：压在图标右上角，圆心正对图标那个角，左右各露出一半。
   原来用 em 定位（left:.68em;top:-.52em）在 14.5px 的正文里只有 11×9 像素、
   字号缩到 7.5px，糊成一坨还压在图标线条上，看着就像错位。
   这里改成固定像素：14px 的圆，直角对齐图标外角，白边用卡片底色描一圈做分离。 */
.bb-timeline .bb-image-count{position:absolute;right:-8px;top:-7px;left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:13px;height:13.5px;padding:0 1.5px;box-sizing:border-box;border:1.5px solid var(--hux-clip-bg,var(--surface,#fff));border-radius:999px;background:var(--accent,#42b983);color:var(--accent-contrast,#fff);font:600 9.5px/1 system-ui,sans-serif;letter-spacing:0;box-shadow:0 1px 3px rgba(0,0,0,.16);pointer-events:none;}
.bb-image-preview{position:absolute;left:0;bottom:calc(100% + 10px);z-index:30;width:min(320px,calc(100vw - 48px));padding:5px;border:1px solid var(--border,#dfe3e6);border-radius:10px;background:var(--surface,#fff);box-shadow:0 12px 32px rgba(0,0,0,.2);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(5px) scale(.985);transform-origin:left bottom;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s;}
.bb-image-preview img{display:block;width:100%;height:auto;max-width:none;max-height:360px;margin:0;border-radius:6px;background:var(--surface-muted,var(--surface,#fff));object-fit:contain;}
/* 缩略图默认贴着图标往右展开。最右那一栏的卡片上，320px 的图会顶出视口 ——
   即使 visibility:hidden 也照样计入滚动溢出，页面就凭空多出一条横向滚动条。
   所以排版时给靠右的卡片挂一个 bb-pv-left，让它改成往左（贴着图标右边缘）展开，
   跟 tooltip 遇到边界翻边是一个道理。 */
.bb-timeline li.bb-pv-left .bb-image-preview{left:auto;right:0;transform-origin:right bottom;}
@media (hover:hover) and (pointer:fine){.bb-image-trigger:hover .bb-image-preview,.bb-image-trigger:focus-visible .bb-image-preview{opacity:1;visibility:visible;transform:translateY(0) scale(1);transition-delay:.16s,.16s,0s;}}
@media (hover:none),(pointer:coarse){.bb-image-preview{display:none;}}

/* --- 优化标签药丸：去掉下划线并增加悬停动效 --- */
.tag-span {
  transition: all 0.2s ease; /* 增加平滑过渡动画 */
}

/* 针对可点击的筛选标签 */
.tag-span.tag-filter {
  text-decoration: none; /* 去掉原本略显生硬的下划线 */
}

/* 标签悬停时的状态 */
.tag-span.tag-filter:hover {
  background-color: rgba(66, 185, 131, 0.1); /* 浮现极浅的主题绿色背景 */
  border-color: #42b983;                     /* 边框颜色加深为纯绿色 */
  color: #42b983;
}

/* --- 统一底部“加载更多”按钮：药丸形状与悬停动效 --- */
.bb-load {
  margin: 1.5em 0 .9em;
}

.bb-load button {
  border-radius: 9999px; /* 从原本的 4px 方角变成完全的圆角药丸 */
  border: 1px solid rgba(66, 185, 131, 0.4); /* 边框改成半透明的绿色，和标签统一 */
  background: transparent; /* 背景透明 */
  transition: all 0.2s ease; /* 增加平滑过渡动画 */
}

/* 样式表里 .bb-load button 有三处（本文件两处、bb-focus.js 一处），
   后面注入的会盖前面的。用 ID 把字号和内距钉死，免得又被 8px/24px 那档顶回去。
   字号跟哔哔正文同一档（15px），别比正文还大。 */
.bb-load #bb-load-more {
  padding: 7px 20px;
  font-size: 15px;
  letter-spacing: .01em;
}

.bb-load button:hover {
  background-color: rgba(66, 185, 131, 0.1); /* 悬停时浮现浅绿色背景 */
  border-color: #42b983;                     /* 悬停时边框高亮成纯绿色 */
  color: #42b983;
}

/* 置顶那条跟其他卡一样进墙、一样按内容长短占栏，只多一圈淡紫内描边
   （老页面标置顶就是这个做法：inset 1px 淡紫，不是换边框色）。
   卡片本身没有边线，所以这圈描边得单独给；悬停时跟着加深一档。 */
.bb-timeline .bb-item.bb-card.is-pinned {
    --bb-ring: rgba(156, 39, 176, .14);
    --bb-ring-hover: rgba(156, 39, 176, .32);
}

.dark-theme .bb-timeline .bb-item.bb-card.is-pinned {
    --bb-ring: rgba(206, 147, 216, .18);
    --bb-ring-hover: rgba(206, 147, 216, .38);
}

/* --- 首页哔哔：卡片墙，可一栏二栏三栏 ---
 * 网格只当画布和尺子（grid-auto-rows: 2px），每张卡的行号、列号都由 layoutBbWall()
 * 自己算好写死，按列往下一张张填 —— 这样只有最后一行会参差，中间不会出现大洞。
 * 交给 auto + dense 的话，跨栏卡必须等它跨的那几列都空到同一行才落得下，
 * 只要其中一列有张长卡，另一列就整片空着。
 * 不用 column-count：某张卡展开评论时会被挤到另一列去，看着像跳了一下。 */
.bb-timeline > ul.bb-wall {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 2px;
    align-items: start;
    column-gap: 26px;
    row-gap: 0;
    margin: 0;
    padding: 0;
}

.bb-timeline > ul.bb-wall > li {
    margin: 0;
    list-style: none;
    min-width: 0;
}

/* 置顶那条固定跨两栏（一栏的窄屏自然退成一栏），高度照内容自适应；
   它是 DOM 第一条，排版时第一个放，所以永远压在左上第一格。 */
.bb-timeline > ul.bb-wall > li.bb-li-pin {
    margin: 0;
}

/* 列数跟着 .main 的实际宽度走：960px 以下正文字段收到 700，三栏会把每栏压到 200 出头，
   正文一行只剩十来个字，所以退两栏；手机再退一栏。 */
@media (max-width: 960px) {
    .bb-timeline > ul.bb-wall { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
    .bb-timeline > ul.bb-wall { grid-template-columns: minmax(0, 1fr); }
}

/* 卡片：**不画边线**，只压一层柔影 + 12px 圆角 —— 这就是改造前首页那条哔哔的样子
   （palettes.css 里 .bb-timeline .bb-item 那套：border 1px + radius 12 + 0 1px 4px 柔影；
   老页面之所以看着「没有边」，是因为底色跟页面同色，只有影子在勾轮廓）。
   上一版我给它描了一圈渐变边、又垫了层白底，反而成了「贴纸」，跟老页面对不上。
   默认只有正文和右下角那行互动摘要，其余要素不显示、也不占行。
   悬停时卡片只在底部长出一条工具栏，正文一个像素都不动。
   用 visibility 而不是 display:none：emoji-reaction 是自定义元素，
   彻底不渲染会量不到宽度，初始化会坏。 */
.bb-timeline .bb-item.bb-card {
    /* 置顶那条另加一圈淡紫内描边（老页面就是这么标的），普通卡这两档是透明的 */
    --bb-ring: transparent;
    --bb-ring-hover: transparent;
    display: flex;
    flex-direction: column;
    padding: .72rem .95rem 12px;
    margin: 0;
    border: 1px solid transparent !important;
    border-image: none !important;
    border-radius: 12px !important;
    background-color: transparent;
    box-shadow:
        inset 0 0 0 1px var(--bb-ring),
        0 1px 4px color-mix(in srgb, var(--shadow, rgba(0, 0, 0, .18)) 58%, transparent) !important;
    transition:
        padding .26s cubic-bezier(.22, .68, .3, 1),
        transform .26s cubic-bezier(.22, .68, .3, 1),
        box-shadow .26s ease;
}

/* 悬停：跟老页面一样 —— 整块上浮 1px，投影从贴着纸面的一层换成散开的 10/28。
   不再左右拓宽（那是墙版自己加的花样，跟「同款效果」冲突），
   底部 34px = 工具栏 26 + 离边 4 + 一点余量。
   （palettes.css 也有一套带 !important 的同名规则，这里用同等权重接回自己的语义。） */
.bb-timeline .bb-item.bb-card:hover,
.bb-timeline .bb-item.bb-card:focus-within {
    padding-bottom: 34px;
    transform: translateY(-1px);
    box-shadow:
        inset 0 0 0 1px var(--bb-ring-hover),
        0 10px 28px color-mix(in srgb, var(--shadow, rgba(0, 0, 0, .18)) 72%, transparent) !important;
    z-index: 3;
}

/* 已经带摘要行的卡片，底部那 22px 本来就占着（悬停时只淡掉、不撤高度），
   工具栏正好住进它原来的位置，所以这条不再长高。 */
.bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):hover,
.bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):focus-within {
    padding-bottom: 12px;
}

/* --- 置顶那一条 ---
   它跟别的卡共用一套结构，只多一枚「置顶」徽标、边线走淡紫。
   顶部那行常显的只有标签和「置顶」；表情、评论按钮改成悬停才现身，
   钉在右上角（绝对定位，不参与排版），所以卡片高度从头到尾一个值。
   不悬停时右上角那格让给只读摘要：已有表情、已有评论缩成和普通卡一样的小字挂在那儿，
   有就显示、没有就空着。 */
.bb-timeline .bb-item.bb-card.is-pinned .bb-info {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 8px;
    margin: 0 0 .6rem !important;
    /* 右上角给按钮留出那一格：标签多了就在这儿换行，不会钻到按钮底下 */
    padding-right: 7.6rem;
}

/* 摘要和按钮共用右上角同一格，一显一隐，切换时不跳 */
.bb-timeline .bb-item.bb-card.is-pinned .bb-pin-hint,
.bb-timeline .bb-item.bb-card.is-pinned .bb-pin-actions {
    position: absolute;
    right: .95rem;
    left: auto !important;
    bottom: auto;
    margin: 0 !important;
}

/* 16px 高的摘要，跟 22px 高的标签行视觉居中 */
.bb-timeline .bb-item.bb-card.is-pinned .bb-pin-hint {
    top: .9rem;
}

.bb-timeline .bb-item.bb-card.is-pinned .bb-pin-actions {
    top: .58rem;
    gap: .35rem;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity .18s ease, visibility 0s linear .18s;
}

.bb-timeline .bb-item.bb-card.is-pinned:hover .bb-pin-actions,
.bb-timeline .bb-item.bb-card.is-pinned:focus-within .bb-pin-actions {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
}

/* 置顶卡悬停不长高、不拓宽：按钮是绝对定位的，没有要展开的行 */
.bb-timeline .bb-item.bb-card.is-pinned,
.bb-timeline .bb-item.bb-card.is-pinned:hover,
.bb-timeline .bb-item.bb-card.is-pinned:focus-within {
    padding: .72rem .95rem .78rem;
    margin: 0;
}

/* 默认态：有表情或评论时，正文底下挂一行极小的摘要。
   它是卡片里的一个普通子项（不是浮层），所以边框把它一起圈住；
   没有互动时 hidden，整行不占高。悬停时淡出，位置交给完整的按钮行。 */
.bb-timeline .bb-card-hint {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: .3rem;
    height: 16px;
    margin: 6px 0 0;
    color: var(--hux-clip-muted, #999);
    font-size: 11.5px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
    opacity: .88;
    pointer-events: none;
    transition: opacity .16s ease;
}

.bb-timeline .bb-card-hint[hidden] { display: none; }

.bb-timeline .bb-hint-item {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    white-space: nowrap;
}

.bb-timeline .bb-hint-item b {
    font-weight: 500;
}

/* 「已有评论」的标记：不做成一行灰字，给个浅底药丸，扫一眼就能挑出来。
   它只在默认态出现（悬停后让位给完整工具栏），所以不能挡住点击。 */
.bb-timeline .bb-hint-cmt {
    height: 16px;
    padding: 0 5px 0 3.5px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 11%, transparent);
    color: var(--hux-clip-muted, #8a8f98);
    gap: 2.5px;
}

.bb-timeline .bb-hint-cmt svg {
    width: 10px;
    height: 10px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* 悬停时只把摘要淡掉、不撤掉它的高度：撤了卡片会矮一截，按钮行反而跳。
   它原来待的那条位置正好让给下面的按钮行（padding-bottom 12 + 22 = 34）。 */
.bb-timeline .bb-item.bb-card:hover .bb-card-hint,
.bb-timeline .bb-item.bb-card:focus-within .bb-card-hint {
    opacity: 0;
    visibility: hidden;
}

/* 悬停才出来的那条工具栏：日期靠左，标签跟在后面，表情和评论并排挤在右侧。
   它住在卡片底部那条内距里，整条都在边框内侧 ——
   鼠标从正文挪到日期上不会「掉出」卡片、工具栏不会闪没，日期链接也就一直点得动。
   默认透明且不吃指针；单行不换行，标签多了就截断，别把右侧按钮挤走。 */
.bb-timeline .bb-item.bb-card .bb-foot-right {
    position: absolute !important;
    right: .95rem;
    bottom: 4px;
    left: .95rem;
    display: flex !important;
    align-items: center;
    gap: .5rem;
    height: 26px;
    margin: 0;
    /* 别给这条加 overflow:hidden —— 表情按钮的选择弹层是绝对定位、往上翻的，
       一裁就等于把挑表情的功能关掉了。标签自己会缩，不会顶到右边去。 */
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(4px);
    transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
}

.bb-timeline .bb-item.bb-card .bb-foot-right .datatime {
    flex: none;
    white-space: nowrap;
}

/* 标签吃到多少算多少，放不下就裁掉尾部，不参与撑行 */
.bb-timeline .bb-item.bb-card .bb-foot-tags {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
}

/* 右侧那一组：表情芯片和评论按钮紧挨着，靠 margin-left:auto 顶到最右 */
.bb-timeline .bb-item.bb-card .bb-foot-actions {
    display: inline-flex !important;
    align-items: center;
    gap: .4rem;
    margin-left: auto;
    flex: none;
}

/* 表情芯片的外壳。这里别用 .bb-foot-actions > div 那种通用写法：
   旧的评论按钮靠 inline 的 display:none 关掉，一条带 !important 的 div 规则会把它顶回来。 */
.bb-timeline .bb-item.bb-card .bb-foot-actions > .bb-react {
    display: inline-flex;
    align-items: center;
}

.bb-timeline .bb-item.bb-card .datatime {
    font-size: 12.5px;
    color: var(--hux-clip-muted, #888);
}

.bb-timeline .bb-item.bb-card .tag-span {
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
}

/* 「置顶」那枚小紫标，高度跟标签齐平，才不会把单行的元信息撑高 */
.bb-timeline .bb-item.bb-card .bb-pin-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    box-sizing: border-box;
    height: 22px;
    padding: 0 8px;
    border: 1px solid rgba(156, 39, 176, .32);
    border-radius: 999px;
    color: #9c27b0;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    flex: none;
}

.dark-theme .bb-timeline .bb-item.bb-card .bb-pin-badge {
    border-color: rgba(206, 147, 216, .42);
    color: #ce93d8;
}

/* 正文 15px：比老页面的 16px 收一档，卡片墙三栏下每行能多落两三个字，
   又没小到像「缩略图」。浮层里那条原帖跟着同档（comments.css 里一起改的），
   同一条哔哔在卡片里和浮层里才不会忽大忽小。 */
.bb-timeline .bb-item.bb-card .bb-cont {
    margin-top: 0;
    font-size: 15px;
    overflow-wrap: anywhere;
}

.bb-timeline .bb-item.bb-card .bb-cont p {
    line-height: 1.72;
    letter-spacing: .01em;
}

.bb-timeline .bb-item.bb-card:hover .bb-foot-right,
.bb-timeline .bb-item.bb-card:focus-within .bb-foot-right {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: none;
    transition-delay: 0s;
}

/* 「已评论 N」：置顶那条的常显元信息里用得上，普通卡靠按钮上的计数，不再重复。 */
.bb-timeline .bb-comment-badge {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border: 1px solid rgba(156, 39, 176, 0.3);
    border-radius: 999px;
    color: #9c27b0;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.bb-timeline .bb-comment-badge[hidden] { display: none; }

.dark-theme .bb-timeline .bb-comment-badge {
    border-color: rgba(206, 147, 216, 0.42);
    color: #ce93d8;
}

/* 手机单列时卡片本身已经满宽，再向外拓宽 6px 就会顶出横向滚动条。
   这一档只加高、不加宽。带摘要行的那条权重更高（:has），得一并写进来。 */
@media (max-width: 640px) {
    .bb-timeline .bb-item.bb-card:hover,
    .bb-timeline .bb-item.bb-card:focus-within,
    .bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):hover,
    .bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):focus-within {
        margin: 0;
        padding-left: .95rem;
        padding-right: .95rem;
    }
}

/* 触屏没有 hover，工具栏就常驻：退回普通文档流，日期在左、表情和评论在右，
   占行也认了，否则手机上连日期和评论入口都点不到。摘要行这时候是多余的。 */
@media (hover: none), (pointer: coarse) {
    .bb-timeline .bb-item.bb-card .bb-foot-right {
        position: static !important;
        height: auto !important;
        margin: .55rem 0 0;
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: none;
        overflow: visible;
    }

    .bb-timeline .bb-item.bb-card .bb-card-hint { display: none; }

    /* 置顶卡同理：按钮退回流里常驻（否则手机上既没有表情入口也没有评论入口），
       右上角那格摘要这时候是多余的。 */
    .bb-timeline .bb-item.bb-card.is-pinned .bb-info { padding-right: 0; }

    .bb-timeline .bb-item.bb-card.is-pinned .bb-pin-actions {
        position: static;
        align-self: flex-end;
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        margin: .5rem 0 0 !important;
    }

    .bb-timeline .bb-item.bb-card.is-pinned .bb-pin-hint { display: none; }

    /* 带摘要行的那条 :has 权重更高，得一并写进来，否则手机上点一下会残留撑开的状态 */
    .bb-timeline .bb-item.bb-card:hover,
    .bb-timeline .bb-item.bb-card:focus-within,
    .bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):hover,
    .bb-timeline .bb-item.bb-card:has(.bb-card-hint:not([hidden])):focus-within {
        padding: .72rem .95rem 12px !important;
        margin: 0;
        transform: none !important;
        background-color: transparent;
        box-shadow: none !important;
    }
}

@media (prefers-reduced-motion: reduce) {
    .bb-timeline .bb-item.bb-card,
    .bb-timeline .bb-item.bb-card .bb-foot-right { transition: none; }
    .bb-timeline .bb-item.bb-card:hover,
    .bb-timeline .bb-item.bb-card:focus-within { transform: none; }
}
`
loadCssCode(allCSS);

let allMemos = [];
let currentPage = 0;
let pageSize = parseInt(bbMemo.limit) || 10;

function getMemoImageUrls(item) {
  if (!item) return [];
  const resourceImages = (Array.isArray(item.resourceList) ? item.resourceList : []).map(res => {
    const url = res && (res.externalLink || res.publicUrl || res.filename || '');
    const type = String(res && res.type || '').toLowerCase();
    return url && (type.startsWith('image') || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) ? url : '';
  }).filter(Boolean);
  const markdownImages = getMarkdownImageUrls(item.content);
  return [...new Set([...resourceImages, ...markdownImages])];
}

function getMarkdownImageUrls(content) {
  const images = [];
  String(content || '').replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g, (match, bracketedUrl, plainUrl) => {
    images.push(bracketedUrl || plainUrl);
    return match;
  });
  return images;
}

function stripMarkdownImages(content) {
  return String(content || '')
    .replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeMemoAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMemoImageTrigger(item) {
  const images = getMemoImageUrls(item);
  if (!images.length) return '';
  const first = escapeMemoAttr(images[0]);
  const count = images.length > 1 ? `<span class="bb-image-count">+${images.length - 1}</span>` : '';
  return `<button class="attach-btn bb-image-trigger" type="button" data-id="${escapeMemoAttr(item.id)}" data-tooltip="查看图片" aria-label="查看${images.length}张图片"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.5-4.5 3.5 3 2.5-2.5 5.5 5"></path></svg>${count}<span class="bb-image-preview" aria-hidden="true"><img class="bb-image-preview-image" src="${first}" alt="" loading="lazy" decoding="async"></span></button>`;
}

function appendMemoImageTrigger(content, trigger) {
  if (!trigger) return content;
  const lastParagraph = content.lastIndexOf('</p>');
  if (lastParagraph !== -1) return content.slice(0, lastParagraph) + `&nbsp;&nbsp;${trigger}` + content.slice(lastParagraph);
  return content + `&nbsp;&nbsp;${trigger}`;
}

// 不展示包含以下标签的哔哔。
// 标签比较时会自动忽略首尾空格、开头的 # 号以及英文字母大小写。
const hiddenMemoTags = new Set(['相册', '影彩', 'clip']);

function shouldHideMemo(item) {
  if (!item || !Array.isArray(item.tags)) return false;

  return item.tags.some(tag => {
    const normalizedTag = String(tag)
      .trim()
      .replace(/^#/, '')
      .toLowerCase();

    return hiddenMemoTags.has(normalizedTag);
  });
}

/* --- 卡片墙：先定跨几栏，再定占几行 ---
 * 跨栏看正文长度，只分三档：短的一栏、中等的两栏、长的整行。
 * data-rand 是渲染时随机定下的一次性骰子，用来在档位边界上错开一点 ——
 * 必须一次定死不能用 Math.random()：重排时会算出发散的结果，宽度一变又触发
 * ResizeObserver，来回震荡停不下来。
 * 行数照搬断章那套 measureRows：先清掉行数，量一遍自然高度，再换算成 2px 行的倍数写回。
 * 底部留白靠多占几行实现（row-gap 设 0），缝隙能精确到 2px；
 * 若用 row-gap，量化单位就是「行高 + 行距」，短卡下面会出现忽宽忽窄的缝。 */
function bbCardSpan(li, columns) {
  const len = parseInt(li.getAttribute('data-len'), 10) || 0;
  const roll = parseFloat(li.getAttribute('data-rand'));
  const r = isNaN(roll) ? 0.5 : roll;
  let span = 1;

  if (columns >= 3) {
    // 一栏约 230px，15px 正文一行十四个字左右。
    // 门槛现在只用来挡住两个极端：短到一行的别撑两栏，长到铺满的别缩回两栏。
    // 中间整段都交给骰子 —— 哔哔大多几十个字，全按长度钉死的话每次刷新
    // 排布一模一样，用户看着像「假瀑布流」。放宽之后半数以上的卡每次刷新
    // 会在 1/2 栏之间换位，墙面才真的在动。
    if (len >= 240) span = 3;
    else if (len >= 150) span = r < 0.5 ? 3 : 2;
    else if (len >= 100) span = r < 0.55 ? 2 : 1;
    else if (len >= 50) span = r < 0.5 ? 2 : 1;
    else if (len >= 28) span = r < 0.35 ? 2 : 1;
    else span = r < 0.15 ? 2 : 1;
  } else if (columns === 2) {
    if (len >= 190) span = 2;
    else span = r < 0.5 ? 2 : 1;
  }

  return Math.min(span, columns);
}

/* --- 卡片墙：自己算坐标的真瀑布流 ---
 * 网格只当画布和尺子，每张卡放第几列、从第几行开始，全由这里算好写死。
 * 为什么不用 auto + dense：跨栏卡必须等它跨的那几列都空到同一行才落得下，
 * 只要其中一列有张长卡，另一列就整片空着 —— 原来那些大洞就是这么来的。
 * 这里改成一列一列往下填：放得下就跨栏、跨栏会在别列留大洞就退回一栏，
 * 于是中间不再有洞，只剩最后一行参差。 */
function bbCardHeight(li) {
  return (li.querySelector('.bb-item') || li).getBoundingClientRect().height;
}

function layoutBbWall() {
  const wall = document.querySelector(bbMemo.domId + ' .bb-wall');
  if (!wall) return;
  const items = Array.prototype.slice.call(wall.children);
  if (!items.length) return;
  // 悬停中的卡片正撑着，这会儿量到的比平时高，行数会虚高、墙面留下空洞。
  // 已经排过版就先跳过，等鼠标离开再补一次（watchBbWall 里挂了 mouseleave）。
  if (bbWallLaid && wall.querySelector('.bb-item:hover')) return;

  /* 排一次版要把每张卡的高度先清成 auto、逐档重量：清掉的那一瞬间，
     每张 li 只剩 grid-auto-rows 那 2px，整面墙塌成几十像素高，文档高度跟着塌，
     浏览器顺手把 scrollTop 夹到新的最大位置 —— 滑到页面底部时正好有图加载完、
     或者 emoji-reaction 把计数撑开，这一次重排就把页面「顶」回上面去了。
     两道保险：量的时候先用 min-height 把墙按当前高度钉住（文档高度不许塌），
     排完再放开；万一还是被夹掉了，末尾把原来的滚动位置放回去。 */
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const frozenH = Math.round(wall.getBoundingClientRect().height);
  if (frozenH > 0) wall.style.minHeight = frozenH + 'px';

  // 先把上一轮写死的列号、行号、高度清干净再数栏数。
  // 带着旧的列号，计算样式里的 grid-template-columns 会把「隐式列」一起报出来
  // （比如列号 3 落在只有一栏的窄屏模板上），一数就是三栏 —— 列数从此永远错，
  // 页面缩窄之后卡片叠成一团就是这么来的。
  items.forEach(li => {
    li.style.gridColumn = '';
    li.style.gridRow = '';
    li.style.height = '';
  });
  wall.getBoundingClientRect();

  const styles = window.getComputedStyle(wall);
  const columns = (styles.getPropertyValue('grid-template-columns') || '')
    .trim().split(/\s+/).filter(Boolean).length || 1;
  const maxSpan = Math.min(3, columns);
  const ROW = 2;
  const GAP = 26; // 竖向缝，跟 column-gap 对齐；悬停时向下长出的 22px 住在里面

  // 一、每种跨度的宽度都量一遍：宽度一变正文就重折行，高度只能真摆上去量。
  //    按 hAt[i][span] 存下来，退栏时直接取那一档，不靠事后估算。
  const hAt = items.map(() => ({}));
  for (let s = 1; s <= maxSpan; s++) {
    items.forEach(li => {
      li.style.gridColumn = 'auto / span ' + s;
      li.style.gridRow = 'auto';
    });
    wall.getBoundingClientRect(); // 强制回流，否则量到的还是上一档的折行
    items.forEach((li, i) => { hAt[i][s] = bbCardHeight(li); });
  }

  // 二、按列往下填。colH 记每列已经用到的高度（含缝）。
  const colH = new Array(columns).fill(0);

  // 候选落点：从第 c 列起跨 span 列，顶到这几列里最高的那列
  function slotAt(c, span) {
    let top = 0;
    for (let k = 0; k < span; k++) top = Math.max(top, colH[c + k]);
    // maxGap 是最矮那列要空出多少才轮得到这张卡 —— 这才是眼睛看到的那道缝；
    // hole 是各列空隙之和，用来在几个落点之间比谁更省地方。
    let hole = 0;
    let maxGap = 0;
    for (let k = 0; k < span; k++) {
      const d = top - colH[c + k];
      hole += d;
      if (d > maxGap) maxGap = d;
    }
    return { c, top, hole, maxGap };
  }

  function planFor(entry, tail) {
    const li = entry.li;
    const pin = li.classList.contains('bb-li-pin');
    const desired = pin
      ? Math.min(2, columns)
      : tail ? columns : Math.min(bbCardSpan(li, columns), columns);
    const narrowH = hAt[entry.i][1] || 0;
    const maxCol = Math.max.apply(null, colH);
    let best = null;

    // 所有「跨度 × 起始列」都试一遍，按「放完以后整面墙的高度 + 洞的代价」打分：
    // 墙高是版面浪费的度量，比盯单张卡那个洞更靠谱 —— 既不会为了一张宽卡在中间掏空，
    // 也不会把尾声拖长。洞另外折一半价，免得为省 20px 墙高在别人下面挖 300px 坑。
    for (let span = desired; span >= 1; span--) {
      const h = hAt[entry.i][span] || narrowH || 40;
      // 跨栏要等它跨的那几列都对齐，最矮那列会空出一截。空出太多就不值当，
      // 除非跨栏确实省下更多高度。收尾那两张另算：它们后面没有卡了，
      // 让宽卡把最后一行铺平，比留一格空格好看。
      const cap = tail ? 9999 : 34;
      for (let c = 0; c + span <= columns; c++) {
        const slot = slotAt(c, span);
        if (span > 1 && slot.maxGap > Math.min(cap, (narrowH - h) * 0.6)) continue;
        const score = Math.max(maxCol, slot.top + h) + slot.hole * 0.5;
        if (!best || score < best.score) best = { span, slot, h, score };
      }
    }

    // 兜底：所有跨度都被否掉时至少放一栏
    if (!best) {
      const h = narrowH || 40;
      let slot = slotAt(0, 1);
      for (let c = 1; c < columns; c++) {
        const s = slotAt(c, 1);
        if (s.top < slot.top) slot = s;
      }
      best = { span: 1, slot, h, score: 0 };
    }
    return best;
  }

  function commit(entry, p) {
    const li = entry.li;
    // 起始行对到 2px 网格上：向上取整，宁可多留 1px 也不重叠
    const top = Math.ceil(p.slot.top / ROW) * ROW;
    const startRow = top / ROW + 1;
    const rows = Math.max(1, Math.ceil((p.h + GAP) / ROW));

    li.style.gridColumn = (p.slot.c + 1) + ' / span ' + p.span;
    li.style.gridRow = startRow + ' / span ' + rows;
    // 高度按默认态锁死：悬停时卡片向下撑开只是视觉溢出，不能再顶开下面一行
    li.style.height = p.h + 'px';
    for (let k = 0; k < p.span; k++) colH[p.slot.c + k] = top + p.h + GAP;
  }

  // 三、按时间顺序一张张放。攒不成跨栏就老实占一栏 —— 顺序不动，
  // 版面也不会因为「等宽卡对齐」在中间掏出一个洞。
  items.forEach((li, i) => commit({ li, i }, planFor({ li, i }, i >= items.length - 2)));

  // 四、贴着视口右边的卡片，悬停缩略图只能往左翻，否则撑出横向滚动条
  const vw = document.documentElement.clientWidth;
  items.forEach(li => {
    const flip = (li.querySelector('.bb-item') || li).getBoundingClientRect().right + 340 > vw;
    if (flip !== li.classList.contains('bb-pv-left')) li.classList.toggle('bb-pv-left', flip);
  });

  // 五、把量高度的临时高度放开，再把中途被夹掉的滚动位置放回去（见上面的 scrollY）
  wall.style.minHeight = '';
  if (window.scrollY !== scrollY || window.scrollX !== scrollX) {
    window.scrollTo(scrollX, scrollY);
  }

  bbWallLaid = true;
}

let bbWallTimer = 0;
let bbWallLaid = false;
function scheduleBbWall() {
  window.clearTimeout(bbWallTimer);
  bbWallTimer = window.setTimeout(layoutBbWall, 80);
}

/* 图片加载、表情按钮异步渲染、评论展开都会改卡片高度，统一交给 ResizeObserver。
   行数变化不影响卡片自身的内容高度（align-items:start），所以不会自己触发自己。
   唯独悬停期间要闭眼：卡片正在撑开，那 48px 不是真实内容高度。 */
let bbWallObserver = null;
function watchBbWall() {
  const wall = document.querySelector(bbMemo.domId + ' .bb-wall');
  if (!wall || typeof ResizeObserver === 'undefined') return;
  if (!bbWallObserver) {
    bbWallObserver = new ResizeObserver(() => {
      if (wall.querySelector('.bb-item:hover')) return;
      scheduleBbWall();
    });
  }
  bbWallObserver.disconnect();
  // 观察卡片本身而不是 li：li 的高度被写死成默认态了，图片加载让卡片长高时
  // li 不会跟着变，盯着 li 就永远收不到通知。
  Array.prototype.forEach.call(wall.children, li => {
    bbWallObserver.observe(li.querySelector('.bb-item') || li);
  });
  // 鼠标一离开就把悬停期间漏掉的那次重排补上
  if (!wall.dataset.hoverBound) {
    wall.dataset.hoverBound = '1';
    wall.addEventListener('mouseleave', scheduleBbWall);
  }
}

window.addEventListener('resize', scheduleBbWall);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleBbWall);

/* 默认态右下角那行「谁搭过话」的摘要。
   表情数取自 emoji-reaction 组件自己拉回来的 availableReactions（不另发请求），
   评论数取自 .bb-comment-badge（twikoo 与自建评论两条链路都会写它）。
   组件是异步拉的，所以渲染后隔几档重试几次；没数据就把整行收掉。 */
const REACTION_EMOJI = {
  'thumbs-up': '👍', 'red-heart': '❤️', cry: '🤣', excited: '🙃', crown: '🤡',
  'smile-face': '😄', 'party-popper': '🎉', cool: '😎', 'confused-face': '😕',
  rocket: '🚀', eyes: '👀', 'thumbs-down': '👎'
};

function paintInteractionHints() {
  const cards = document.querySelectorAll(bbMemo.domId + ' .bb-li-card');
  let heightChanged = false;
  Array.prototype.forEach.call(cards, li => {
    const hint = li.querySelector('.bb-card-hint');
    if (!hint) return;
    const el = li.querySelector('emoji-reaction');
    const list = el && Array.isArray(el.availableReactions) ? el.availableReactions : [];
    const hits = list.filter(r => Number(r.count) > 0).slice(0, 3);
    // 评论数：置顶那条在常显的「已评论 N」徽标里，普通卡只有按钮上的计数
    const badge = li.querySelector('.bb-comment-badge');
    const pillCount = li.querySelector('.cm-pill-count');
    let comments = 0;
    if (badge && !badge.hidden) {
      comments = Number((String(badge.textContent).match(/\d+/) || [0])[0]) || 0;
    } else if (pillCount) {
      comments = Number(String(pillCount.textContent).trim()) || 0;
    }

    const parts = hits.map(r => {
      const emoji = r.emoji || REACTION_EMOJI[r.reaction_name] || '🙂';
      return '<span class="bb-hint-item">' + emoji + '<b>' + Number(r.count) + '</b></span>';
    });
    // 「这条有人搭过话」的标记：给个带底色的圆角小药丸，
    // 不然和表情数混在一行里，扫一眼看不出是评论。
    if (comments) {
      parts.push('<span class="bb-hint-item bb-hint-cmt">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>' +
        '<b>' + comments + '</b></span>');
    }

    // 摘要行现在是卡片里的普通子项，显/隐会改变卡片高度，所以要通知重排
    if (!parts.length) {
      if (!hint.hidden) heightChanged = true;
      hint.hidden = true;
      hint.innerHTML = '';
      return;
    }
    if (hint.hidden) heightChanged = true;
    hint.innerHTML = parts.join('');
    hint.hidden = false;
  });

  if (heightChanged) scheduleBbWall();
}

// 评论计数是另一支脚本（bb-comments.js）异步写回来的，让它写完顺手补一下摘要行
window.paintInteractionHints = paintInteractionHints;

/* 置顶卡的表情按钮住在右上角，组件自带的挑选弹层是「往上翻」的，
   照原样会翻到卡片外面、压到页面头部。给这一个实例补一条样式改成往下展开。
   普通卡不动，还是从底部工具栏往上翻。 */
function tunePinnedPopup() {
  const host = document.querySelector(bbMemo.domId + ' .bb-item.is-pinned emoji-reaction');
  if (!host) return;
  const apply = () => {
    const root = host.shadowRoot;
    if (!root || root.querySelector('style[data-bb-pin]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-bb-pin', '1');
    style.textContent =
      '.reaction-available-popup{left:auto!important;right:0!important;' +
      'top:calc(100% + 6px)!important;bottom:auto!important;' +
      'width:max-content!important;flex-wrap:nowrap!important;' +
      'max-width:min(320px,86vw)!important;overflow-x:auto;}';
    root.appendChild(style);
  };
  if (host.updateComplete && host.updateComplete.then) host.updateComplete.then(apply);
  [60, 400, 1200].forEach(ms => setTimeout(apply, ms));
}

function renderMemosPaged(memos, page) {
  let end = (page + 1) * pageSize;
  let showMemos = memos.slice(0, end);
  let result = "";
  
  showMemos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return;
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    let tags = (item.tags || []).map(tag => `<span class="tag-span tag-filter" data-tag="${tag}">#${tag}</span>`).join(' ');
    
    let attachBtn = renderMemoImageTrigger(item);

    let contentText = stripMarkdownImages(item.content).replace(/#[^\s#]+/g, '').trim();
    // 引用标记 `[ID.x](/m/x/)` 展开成文末的引用卡片；手写引用的条目保持原样。
    if (window.bbQuote) contentText = window.bbQuote.expand(contentText, allMemos);
    // 1. 直接解析去除了标签的纯文本
    let content = window.marked ? marked.parse(contentText.replace(/\n/g, '  \n')) : contentText.replace(/\n/g, '  \n');
    content = appendMemoImageTrigger(content, attachBtn);

    // 表情 + 评论按钮：置顶那条和卡片共用的那一小截
    const reactions = `<span class="bb-react">
                <emoji-reaction theme="system" endpoint="https://emaction-api.hux.ink" reacttargetid="memo-${item.id}" style="line-height:normal;"></emoji-reaction>
              </span>

              <div class="comment-pill-btn twikoo-badge-${item.id}" data-id="${item.id}" data-twienv="${bbMemo.twiEnv}" title="点击评论">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                <span class="count-num" style="display: none; padding-top: 1px;">0</span>
              </div>`;

    const memoBody = `
          <div class="item-attach attach-${item.id} d-none"></div>
          
          <div class="twikoo-wrapper-${item.id} d-none" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #eee;">
             <div id="twikoo-mount-${item.id}"></div>
          </div>`;

    // 置顶那条跟其他卡共用一套结构，只多一枚「置顶」徽标、边线走淡紫。
    // 顶部那行常显的只有标签和「置顶」；表情、评论按钮悬停才现身，
    // 绝对定位钉在右上角。不悬停时同一格挂着只读摘要（已有表情 / 已有评论）。
    // 底部那行整个不要 —— 日期对「此刻」这条没意义。
    // 它永远排在第一个（DOM 第一条，排版时第一个放），固定跨两栏。
    // data-len 给 bbCardSpan() 定跨栏用，data-rand 是这次渲染的一次性骰子。
    const pinBadge = item.isPinned
      ? `<span class="bb-pin-badge"><svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>置顶</span>`
      : '';
    const pinMeta = item.isPinned
      ? `<div class="bb-info">
            ${tags}
            ${pinBadge}
          </div>`
      : '';
    // 普通卡：默认一行摘要（有互动才有），悬停时让位给底部工具栏
    // 置顶卡：摘要和按钮挤在右上角同一格，一显一隐
    const cardFoot = item.isPinned
      ? `<span class="bb-card-hint bb-pin-hint" hidden></span>
         <span class="bb-foot-actions bb-pin-actions">${reactions}</span>`
      : `<span class="bb-card-hint" hidden></span>

          <div class="bb-foot-right">
            <a class="datatime" href="/m/${item.id}/" data-tip="${dateStr}">${dateStr}</a>
            ${!tags ? '' : `<span class="bb-foot-tags">${tags}</span>`}
            <span class="bb-foot-actions">${reactions}</span>
          </div>`;

    result += `
      <li class="bb-li-card${item.isPinned ? ' bb-li-pin' : ''}" data-len="${contentText.length}" data-rand="${Math.random().toFixed(3)}">
       <div class="bb-item bb-card${item.isPinned ? ' is-pinned' : ''}" style="position:relative;">
          ${pinMeta}

          <div class="bb-cont">${content}</div>

          ${cardFoot}
${memoBody}
        </div>
      </li>
    `;
  });
  
  document.querySelector(bbMemo.domId).innerHTML = `<section class="bb-timeline"><ul class="bb-wall">${result}</ul></section>` + (end < memos.length ? `<div class="bb-load"><button id="bb-load-more">更多哔话</button></div>` : "");

  // 卡片墙的行数要等 DOM 落地才量得准
  layoutBbWall();
  watchBbWall();

  // 表情计数、评论数都是异步回来的，隔几档补画摘要行
  [300, 900, 2000, 3600].forEach(ms => setTimeout(paintInteractionHints, ms));

  // 置顶卡的表情按钮钉在右上角，组件默认的「往上翻」会顶出卡片顶部，
  // 给这一个实例换成往下展开
  [120, 600, 1600].forEach(ms => setTimeout(tunePinnedPopup, ms));

  const doToggle = (memoId, envId) => {
    const wrapper = document.querySelector(`.twikoo-wrapper-${memoId}`);
    if (!wrapper) return;
    
    if (wrapper.classList.contains('d-none')) {
      wrapper.classList.remove('d-none');
      const mountPoint = document.getElementById(`twikoo-mount-${memoId}`);
      if (mountPoint && !mountPoint.hasAttribute('data-tk-init') && typeof twikoo !== 'undefined') {
        mountPoint.setAttribute('data-tk-init', 'true');
        mountPoint.innerHTML = `<div class="loader" style="width:30px;margin:1rem auto;"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
        twikoo.init({ envId: envId, el: `#twikoo-mount-${memoId}`, path: `/memos/${memoId}` });
      }
    } else {
      wrapper.classList.add('d-none');
    }
  };

  // 修改后的代码：排除掉包含 attach-btn 类的按钮
  document.querySelectorAll('.comment-pill-btn:not(.attach-btn)').forEach(btn => {
    btn.onclick = function(e) {
      e.preventDefault(); 
      e.stopPropagation();
      doToggle(this.getAttribute('data-id'), this.getAttribute('data-twienv'));
    };
  });

  if (window.ViewImage) ViewImage.init('.bb-cont img:not(.bb-image-preview-image)');
  if (window.Lately) Lately.init({ target: '.datatime' });

  // --- 首页修复逻辑 ---
  document.querySelectorAll('.attach-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      const memoId = this.getAttribute('data-id');
      const memo = allMemos.find(m => m.id == memoId);
      if (memo && getMemoImageUrls(memo).length) {
        
        // 斩草除根：清理一切残留
        document.querySelectorAll('.temp-img-box').forEach(el => el.remove());

        let temp = document.createElement('div');
        temp.className = 'temp-img-box';
        temp.id = 'temp-v-' + memoId; 
        temp.style.display = 'none'; 
        document.body.appendChild(temp);
        
        getMemoImageUrls(memo).forEach(link => {
          if (link) {
            let img = document.createElement('img'); 
            img.src = link; 
            img.setAttribute('data-view-image', ''); 
            temp.appendChild(img);
          }
        });
        
        if (window.ViewImage) {
          ViewImage.init('#' + temp.id + ' img');
          setTimeout(() => { if(temp.querySelector('img')) temp.querySelector('img').click(); }, 50);
        }
      }
    });
  });

  if (typeof twikoo !== 'undefined' && bbMemo.twiEnv) {
    twikoo.getCommentsCount({ envId: bbMemo.twiEnv, urls: showMemos.map(i => `/memos/${i.id}`), includeReply: false }).then(res => {
      res.forEach(i => {
        if (i.count > 0) {
          const pill = document.querySelector(`.twikoo-badge-${i.url.replace('/memos/', '')}`);
          if (pill) { 
            const numSpan = pill.querySelector('.count-num');
            if (numSpan) {
              numSpan.style.display = 'inline-block';
              numSpan.innerText = i.count; 
            }
            // --- 新增：当已有评论时，将药丸渲染为紫色 ---
            pill.style.color = '#9c27b0';
            pill.style.borderColor = 'rgba(156, 39, 176, 0.3)';
            // 卡片顶部那颗「已评论 N」也一起点亮，悬停前就能看见有多少人说过话
            const badge = pill.closest('.bb-item') && pill.closest('.bb-item').querySelector('.bb-comment-badge');
            if (badge) {
              badge.textContent = '已评论 ' + i.count;
              badge.hidden = false;
              scheduleBbWall();
              paintInteractionHints();
            }
          }
        }
      });
    });
  }

  if (window.Lately) Lately.init({ target: '.datatime' });
  if (window.emactionInit) emactionInit();
  
  let loadMoreBtn = document.getElementById('bb-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.onclick = function() {
      window.location.href = 'https://hux.ink/bb/';
    }
  }
  // 在标签点击事件后加
  let showAllBtn = document.getElementById('bb-show-all');
  if (showAllBtn) {
    showAllBtn.onclick = function() {
      currentPage = 0;
      renderMemosPaged(allMemos, currentPage);
    }
  }
}

/* 入口。用 readyState 判断而不是死等 DOMContentLoaded：
   这个文件现在由 recent-memo.html 里的一小段脚本按开关动态插入
   （新版卡片墙 / 旧版单列二选一），动态插入时 DOMContentLoaded 可能已经过去了，
   只挂监听就永远不跑，页面一直卡在 loading 圈上。 */
function bootBbHome() {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos).then(res => res.json()).then(data => {
      // 必须先过滤，再执行置顶逻辑，避免被隐藏的条目进入首页或被置顶。
      data = Array.isArray(data)
        ? data.filter(item => !shouldHideMemo(item))
        : [];
      
      // --- 置顶逻辑开始 ---
      // 查找第一条包含 'Now' 或 'now' 标签的 memo 索引（因为本身是倒序，第一条即最近一条）
      let pinIndex = data.findIndex(item => item.tags && (item.tags.includes('Now') || item.tags.includes('now')));
      
      // 如果找到了，并且它不是原本的第一条，就把它移到数组最前面
      if (pinIndex > 0) {
        let pinMemo = data.splice(pinIndex, 1)[0];
        pinMemo.isPinned = true; // 增加一个置顶的标识，方便我们在渲染时加个UI提示
        data.unshift(pinMemo);
      } else if (pinIndex === 0) {
        // 如果它本来就是第一条，只需要加上标识即可
        data[0].isPinned = true; 
      }
      // --- 置顶逻辑结束 ---

      allMemos = data; 
      renderMemosPaged(allMemos, 0); 
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootBbHome);
} else {
  bootBbHome();
}
