/*
Last Modified time : 20240704 by Copilot / Updated for Filter 2026 v2
*/
let bbMemo = {
  memos: '/memos.json',
  limit: 20, 
  creatorId: '1',
  domId: '#bber',
  twiEnv: ''
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
.bb-timeline ul{margin:0;padding:0;}
.bb-timeline ul li{margin-bottom:3rem;list-style-type:none;}
.bb-timeline ul li .bb-cont ul li{margin-bottom:0;}
.bb-timeline .bb-item,.bb-load button{border:1px solid #dcdcdc;border-radius:8px;box-shadow:3px 3px 5px rgba(0,0,0,.1);}
.bb-timeline .bb-item{padding:.6rem 1rem .6rem;font-size:16px;}
.bb-timeline .bb-info{position:relative;margin-top:.5rem;font-size:14px;}
.bb-timeline .bb-info a{text-decoration:none;}
.bb-timeline .datatime{font-size:15px;}
.bb-timeline .bb-cont{overflow-x:hidden;margin-top:.5rem;}
.bb-timeline .datacount{position:absolute;right:0;bottom:0;cursor:pointer;display:flex;align-items:center;color:#42b983;font-size:1em;background:none;border:none;outline:none;padding:0 6px;}
.bb-timeline .datacount svg{margin-left:4px;vertical-align:middle;}
.bb-timeline .bb-cont img[src*=emotion]{display:inline-block;width:auto;}
.bb-timeline p{margin:0;min-height:18px;color:#3b3d42;letter-spacing:1px;line-height:28px;}
.bb-timeline pre{color:#aaa;}
.bb-timeline pre p{display:inline-block;}
.bb-timeline pre p:empty{display:none;}
.bb-cont blockquote{position:relative;margin:0 0 0 1rem;padding:.25rem 2rem;border-left:0 none;}
.bb-cont blockquote::before{position:absolute;top:5px;left:10px;content:'“';font-weight:700;font-size:28px;line-height:2rem;}
.tag-span{color:#42b983;font-weight:normal;background:transparent;border:1px solid rgba(66,185,131,0.4);border-radius:9999px;padding:0 10px;font-size:13px;display:inline-flex;align-items:center;justify-content:center;height:26px;box-sizing:border-box;margin-right:4px;}
.tag-span.tag-filter {cursor: pointer;text-decoration: underline;}
.resimg.grid{display:grid;box-sizing:border-box;margin:4px 0 0;width:calc(100%* 2 / 3);grid-template-columns:repeat(3,1fr);grid-template-rows:auto;gap:4px;}
.resimg.grid-2{width:80%;grid-template-columns:repeat(2,1fr);}
.resimg.grid-4{width:calc(80% * 2 / 3);grid-template-columns:repeat(2,1fr);}
.resimg.grid figure.gallery-thumbnail{position:relative;padding-top:100%;width:140px;height:96px;cursor:zoom-in;}
.resimg figure{text-align:left;overflow: hidden;}
.resimg figure img{max-width:140px;max-height:96px;width:140px;height:96px;object-fit:cover;border-radius:6px;cursor:pointer;}
.resimg.grid figure,figcaption{margin:0!important;}
.resimg.grid figure.gallery-thumbnail>img.thumbnail-image{position:absolute;top:0;left:0;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%;}
.loader {position: relative;margin:3rem auto;width: 100px;}
.loader::before {content: '';display: block;padding-top: 100%;}
.circular {animation: rotate 2s linear infinite;height: 100%;transform-origin: center center;width: 100%;position: absolute;top: 0;bottom: 0;left: 0;right: 0;margin: auto;}
.path {stroke-dasharray: 1, 200;stroke-dashoffset: 0;animation: dash 1.5s ease-in-out infinite, color 6s ease-in-out infinite;stroke-linecap: round;}
@keyframes rotate {100% {transform: rotate(360deg);}}
@keyframes dash {
  0% {stroke-dasharray: 1, 200;stroke-dashoffset: 0;}
  50% {stroke-dasharray: 89, 200;stroke-dashoffset: -35px;}
  100% {stroke-dasharray: 89, 200;stroke-dashoffset: -124px;}
}
@keyframes color {
  100%,0% {stroke: #d62d20;}40% {stroke: #0057e7;}66% {stroke: #008744;}80%,90% {stroke: #ffa700;}
}
.item-twikoo {margin: 2rem 0 0 0;}
.d-none {display: none !important;}
.emoji-reaction-bar {margin-bottom: 0.5em;display: flex;align-items: center;gap: 8px;}
.bb-load {text-align: center;margin: 2em 0 1em 0;}
.bb-load button {background: #fff;color: #42b983;border: 1px solid #42b983;border-radius: 4px;padding: 8px 24px;font-size: 1em;cursor: pointer;transition: background .2s;}
.bb-load button:hover {background: #42b983;color: #fff;}
.bb-cont img,.resimg img,.gallery-thumbnail img,.thumbnail-image {max-width: 100%;max-height: 320px;height: auto;width: auto;display: block;margin: 0.5em 0;object-fit: contain;}
.datacount {position: relative;display: inline-flex;align-items: center;cursor: pointer;}
.comment-count {margin-left: 4px;font-size: 12px;color: #800080;background: rgba(255, 255, 255, 0.8);border-radius: 8px;padding: 0 4px;}
.datacount:hover svg path {fill: #a040a0;}
/* 💬 极简气泡药丸胶囊 */
.comment-pill-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 2px 8px; /* display: none !important;修改为隐藏，!important 确保强制生效 不隐藏的时候改回 display: inline-flex;*/ 
  background: #ffffff; color: #555; border-radius: 14px; 
  font-size: 13px; cursor: pointer; transition: all 0.2s;
  border: 1px solid #e1e4e8; height: 26px; box-sizing: border-box; 
  line-height: 1; vertical-align: middle; min-width: 26px;
}
.comment-pill-btn:hover { background: #f6f8fa; border-color: #d1d5da; color: #42b983; }
.dark-theme .comment-pill-btn { background: #2d333b; color: #adbac7; border-color: #444c56; }
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
.bb-load button {
  border-radius: 9999px; /* 从原本的 4px 方角变成完全的圆角药丸 */
  border: 1px solid rgba(66, 185, 131, 0.4); /* 边框改成半透明的绿色，和标签统一 */
  background: transparent; /* 背景透明 */
  transition: all 0.2s ease; /* 增加平滑过渡动画 */
}

.bb-load button:hover {
  background-color: rgba(66, 185, 131, 0.1); /* 悬停时浮现浅绿色背景 */
  border-color: #42b983;                     /* 悬停时边框高亮成纯绿色 */
  color: #42b983;
}
`
loadCssCode(allCSS);

let allMemos = [];
let currentFilteredMemos = []; 
let currentPage = 0;
let pageSize = parseInt(bbMemo.limit) || 20;
bbMemo.viewImageDelay = bbMemo.viewImageDelay || 50;

let parsedDates = {}; 
let currentYear = 'all';
let currentMonth = 'all';

function initFiltersData() {
  parsedDates = {};
  allMemos.forEach(m => {
    let d = new Date(m.createdTs * 1000);
    let y = d.getFullYear().toString();
    let mo = (d.getMonth() + 1).toString().padStart(2, '0');
    if (!parsedDates[y]) parsedDates[y] = new Set();
    parsedDates[y].add(mo);
  });
}

function renderYearFilter() {
  let filterDiv = document.getElementById('memos-filter');
  if (!filterDiv) return;
  filterDiv.style.display = 'flex'; // 已在CSS中定义，此处确保显示
  
  let yearNav = document.getElementById('memos-year-nav');
  yearNav.innerHTML = '';
  
  let years = Object.keys(parsedDates).sort((a, b) => b - a);

  let allYBtn = document.createElement('li');
  allYBtn.className = 'button ' + (currentYear === 'all' ? 'selected' : '');
  allYBtn.textContent = '全部';
  allYBtn.onclick = () => { currentYear = 'all'; currentMonth = 'all'; renderYearFilter(); applyFilters(); };
  yearNav.appendChild(allYBtn);

  years.forEach(y => {
    let btn = document.createElement('li');
    btn.className = 'button ' + (currentYear === y ? 'selected' : '');
    btn.textContent = y;
    btn.onclick = () => { currentYear = y; currentMonth = 'all'; renderYearFilter(); applyFilters(); };
    yearNav.appendChild(btn);
  });

  renderMonthFilter();
}

function renderMonthFilter() {
  let monthContainer = document.getElementById('month-nav-container');
  let monthNav = document.getElementById('memos-month-nav');
  if (!monthContainer || !monthNav) return;

  monthNav.innerHTML = '';
  
  if (currentYear === 'all') {
    monthContainer.style.display = 'none';
    return; 
  }
  
  monthContainer.style.display = 'flex';
  let months = Array.from(parsedDates[currentYear]).sort((a, b) => b - a);

  let allMBtn = document.createElement('li');
  allMBtn.className = 'button ' + (currentMonth === 'all' ? 'selected' : '');
  allMBtn.textContent = '全年'; // 修改2：月份的第一项改为全年
  allMBtn.onclick = () => { currentMonth = 'all'; renderMonthFilter(); applyFilters(); };
  monthNav.appendChild(allMBtn);

  months.forEach(m => {
    let btn = document.createElement('li');
    btn.className = 'button ' + (currentMonth === m ? 'selected' : '');
    btn.textContent = m + '月';
    btn.onclick = () => { currentMonth = m; renderMonthFilter(); applyFilters(); };
    monthNav.appendChild(btn);
  });
}

function applyFilters() {
  currentFilteredMemos = allMemos.filter(m => {
    let d = new Date(m.createdTs * 1000);
    let y = d.getFullYear().toString();
    let mo = (d.getMonth() + 1).toString().padStart(2, '0');

    if (currentYear !== 'all' && y !== currentYear) return false;
    if (currentMonth !== 'all' && mo !== currentMonth) return false;
    return true;
  });

  currentPage = 0;
  renderMemosPaged(currentFilteredMemos, currentPage);
}

function renderMemosPaged(memos, page) {
  let start = 0;
  let end = (page + 1) * pageSize;
  let showMemos = memos.slice(0, end);
  let result = "";
  
  // 修改：彻底去除了之前判断条件下的 “显示全部哔哔” 按钮
  
  showMemos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return;
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    let tags = (item.tags || []).map(tag => `<span class="tag-span tag-filter" data-tag="${tag}">#${tag}</span>`).join(' ');
    
    let attachBtn = '';
    if (item.resourceList && item.resourceList.length > 0) {
      attachBtn = `
        <span class="attach-btn comment-pill-btn" style="position: absolute; right: 0; bottom: 0;" data-id="${item.id}" title="查看附件图片">
          <svg t="1717750000000" class="icon" viewBox="0 0 1024 1024" width="14" height="14">
            <path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="currentColor"/>
          </svg> 查看图片
        </span>
      `;
    }
    let contentText = item.content.replace(/#[^\s#]+/g, '').replace(/^\s+|\s+$/g, '');
    // 直接解析去除了标签的纯文本
    let content = window.marked ? marked.parse(contentText.replace(/\n/g, '  \n')) : contentText.replace(/\n/g, '  \n');

    let emojiBar = `<span class="emoji-reaction-bar" style="display:inline-flex;vertical-align:middle;"><emoji-reaction theme="system" endpoint="https://api-emaction.immmmm.com" reacttargetid="memo-${item.id}" style="line-height:normal;display:inline-flex;"></emoji-reaction></span>`;
    
    let datacountDOM = `
      <span class="datacount" data-twienv="${bbMemo.twiEnv}" data-id="${item.id}" title="评论">
        <svg t="1717750000000" class="icon" viewBox="0 0 1024 1024" width="20" height="20">
          <path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="${item.commentCount > 0 ? '#800080' : '#42b983'}"/>
        </svg>
        ${item.commentCount > 0 ? `<span class="comment-count">${item.commentCount}</span>` : ''}
      </span>
    `;
    result += `
      <li>
        <div class="bb-item" style="position:relative;">
          <div class="bb-cont">
            ${content}
          </div>
          <div class="bb-info" style="position:relative; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
            ${emojiBar}<span class="datatime" title="${dateStr}">${dateStr}</span>${tags}
            ${attachBtn}
          </div>
          <div class="item-attach attach-${item.id} d-none"></div>
        </div>
      </li>
    `;
  });
  
  let html = `<section class="bb-timeline"><ul>${result}</ul></section>`;
  
  if (end < memos.length) {
    html += `<div class="bb-load"><button id="bb-load-more">加载更多</button></div>`;
  }
  document.querySelector(bbMemo.domId).innerHTML = html;

  document.querySelectorAll('.tag-span.tag-filter').forEach(span => {
    span.onclick = function() {
      const tag = this.getAttribute('data-tag');
      currentFilteredMemos = allMemos.filter(m => (m.tags || []).includes(tag));
      currentPage = 0;
      
      currentYear = 'all';
      currentMonth = 'all';
      renderYearFilter();
      
      renderMemosPaged(currentFilteredMemos, currentPage);
    }
  });

  if (window.ViewImage) ViewImage.init('.bb-cont img');
  if (window.Lately) Lately.init({ target: '.datatime' });

  document.querySelectorAll('.attach-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const memoId = btn.getAttribute('data-id');
      const memo = allMemos.find(m => m.id == memoId);

      if (memo && memo.resourceList && memo.resourceList.length > 0) {
        
        // 🐛 核心修复：斩草除根！在创建新的图片容器前，先把之前残留的所有隐藏容器全部删掉
        document.querySelectorAll('div[id^="temp-image-viewer-"]').forEach(el => el.remove());

        let tempContainer = document.createElement('div');
        tempContainer.id = 'temp-image-viewer-' + memoId;
        tempContainer.style.display = 'none';
        document.body.appendChild(tempContainer);

        let imageCount = 0;
        memo.resourceList.forEach(res => {
          let resLink = res.externalLink || res.publicUrl || res.filename || '';
          let restype = res.type ? res.type.slice(0,5) : '';
          if ((restype === 'image' || (resLink && resLink.match(/\.(jpg|jpeg|png|gif|webp)$/i))) && resLink) {
            let img = document.createElement('img');
            img.src = resLink;
            img.setAttribute('data-view-image', '');
            tempContainer.appendChild(img);
            imageCount++;
          }
        });

        if (imageCount > 0) {
          if (window.ViewImage) {
            ViewImage.init('#' + tempContainer.id + ' img');
              const delay = parseInt(bbMemo.viewImageDelay) || 50;
              setTimeout(() => {
                const firstImg = tempContainer.querySelector('img');
                if (firstImg) firstImg.click();
              }, delay);

              let cleaned = false;
              const cleanTemp = () => {
                if (cleaned) return;
                cleaned = true;
                if (tempContainer && tempContainer.parentNode) tempContainer.remove();
                closeEventNames.forEach(ev => document.removeEventListener(ev, closeHandlers[ev]));
                if (fallbackTimer) clearTimeout(fallbackTimer);
              };

              const closeEventNames = [
                'view-image-close','viewimage:close','view-image:close',
                'view-image-hide','view-image:hide','viewimage-close'
              ];
              const closeHandlers = {};
              closeEventNames.forEach(ev => {
                closeHandlers[ev] = function() { cleanTemp(); };
                document.addEventListener(ev, closeHandlers[ev]);
              });

              const fallbackTimer = setTimeout(() => {
                cleanTemp();
              }, 15000);
          } else {
            const firstImg = tempContainer.querySelector('img');
            if (firstImg) window.open(firstImg.src, '_blank');
            tempContainer.remove();
          }
        } else {
          tempContainer.remove();
        }
      }
    });
  });

  if (window.emactionInit) {
    emactionInit();
  }

  let loadMoreBtn = document.getElementById('bb-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.onclick = function() {
      currentPage++;
      renderMemosPaged(currentFilteredMemos, currentPage);
    }
  }
}

document.addEventListener('DOMContentLoaded', function() {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos)
      .then(res => res.json())
      .then(data => {
        allMemos = data;
        currentFilteredMemos = [...allMemos]; 
        
        initFiltersData(); 
        renderYearFilter(); 
        
        currentPage = 0;
        renderMemosPaged(currentFilteredMemos, currentPage); 
      });
  }
});