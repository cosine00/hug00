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
.bb-timeline ul{margin:0;padding:0;}
.bb-timeline ul li{margin-bottom:3rem;list-style-type:none;}
.bb-timeline .bb-item,.bb-load button{border:1px solid #dcdcdc;border-radius:8px;box-shadow:3px 3px 5px rgba(0,0,0,.1);}
.bb-timeline .bb-item{padding:.6rem 1rem .6rem;font-size:16px;}
.bb-timeline .bb-info{position:relative;margin-top:.5rem;font-size:14px;}
.bb-timeline .datatime{font-size:15px;}
.bb-timeline .bb-cont{overflow-x:hidden;margin-top:.5rem;}
.bb-timeline .datacount{position:absolute;right:0;bottom:0;cursor:pointer;display:flex;align-items:center;color:#42b983;font-size:1em;background:none;border:none;outline:none;padding:0 6px;}
.bb-timeline .bb-cont img[src*=emotion]{display:inline-block;width:auto;}
.bb-timeline p{margin:0;min-height:18px;color:#3b3d42;letter-spacing:1px;line-height:28px;}
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

/* --- 置顶卡片专属外框样式 (回归极简) --- */
.bb-timeline .bb-item.pinned-bg {
  border: 1px solid rgba(156, 39, 176, 0.2) !important; /* 仅保留极淡的紫色边线，起微微勾勒作用 */
  box-shadow: none !important; /* 彻底去掉阴影，不让它浮起来 */
  background-color: transparent !important; /* 绝对透明，完美融入你的深灰/纯白底色 */
  transition: all 0.3s ease;
}

/* 暗色模式适配 */
.dark-theme .bb-timeline .bb-item.pinned-bg {
  border: 1px solid rgba(156, 39, 176, 0.3) !important; /* 暗色模式下稍微提亮一点点边框，但依然保持极细 */
  background-color: transparent !important; /* 坚决不要背景色 */
}
`
loadCssCode(allCSS);

let allMemos = [];
let currentPage = 0;
let pageSize = parseInt(bbMemo.limit) || 10;

function renderMemosPaged(memos, page) {
  let end = (page + 1) * pageSize;
  let showMemos = memos.slice(0, end);
  let result = "";
  
  showMemos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return;
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    let tags = (item.tags || []).map(tag => `<span class="tag-span tag-filter" data-tag="${tag}">#${tag}</span>`).join(' ');
    
    let attachBtn = '';
    if (item.resourceList && item.resourceList.length > 0) {
      // 1. 删除了 datacount 类，彻底解决 CSS 冲突
      // 2. 加上了 style="position: absolute; right: 0; bottom: 0;" 保持右下角定位
      // 3. 将 svg 尺寸调整为 width="14" height="14"
      attachBtn = `<span class="attach-btn comment-pill-btn" style="position: absolute; right: 0; bottom: 0;" data-id="${item.id}" title="查看图片"><svg t="1717750000000" viewBox="0 0 1024 1024" width="14" height="14"><path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="currentColor"/></svg>查看图片</span>`;
    }

    let contentText = item.content.replace(/#[^\s#]+/g, '').trim();
    // 1. 直接解析去除了标签的纯文本
    let content = window.marked ? marked.parse(contentText.replace(/\n/g, '  \n')) : contentText.replace(/\n/g, '  \n');

    result += `
      <li>
       <div class="bb-item" style="position:relative; ${item.isPinned ? 'border: 1px solid rgba(156, 39, 176, 0.3) !important;' : ''}">
          <div class="bb-cont">${content}</div>
          <div class="bb-info" style="position:relative; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
            <div style="display:inline-flex; align-items:center; gap:12px;">
              <div class="comment-pill-btn twikoo-badge-${item.id}" data-id="${item.id}" data-twienv="${bbMemo.twiEnv}" title="点击评论">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                <span class="count-num" style="display: none; padding-top: 1px;">0</span>
              </div>
              
              <div style="display:inline-flex;">
                <emoji-reaction theme="system" endpoint="https://api-emaction.immmmm.com" reacttargetid="memo-${item.id}" style="line-height:normal;"></emoji-reaction>
              </div>
            </div>
            
            ${item.isPinned ? '' : `&nbsp;&nbsp;<span class="datatime" title="${dateStr}">${dateStr}</span>`}
            ${tags}
            ${item.isPinned ? `<span style="display:inline-flex; align-items:center; justify-content:center; gap:4px; color:#9c27b0; border:1px solid rgba(156, 39, 176, 0.3); font-size:13px; padding:2px 8px; border-radius:14px; height:26px; box-sizing:border-box;"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>置顶</span>` : ''}
            ${attachBtn}
          </div>
          
          <div class="item-attach attach-${item.id} d-none"></div>
          
          <div class="twikoo-wrapper-${item.id} d-none" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #eee;">
             <div id="twikoo-mount-${item.id}"></div>
          </div>
        </div>
      </li>
    `;
  });
  
  document.querySelector(bbMemo.domId).innerHTML = `<section class="bb-timeline"><ul>${result}</ul></section>` + (end < memos.length ? `<div class="bb-load"><button id="bb-load-more">加载更多</button></div>` : "");

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

  // 标签筛选功能
  document.querySelectorAll('.tag-span.tag-filter').forEach(span => {
    span.onclick = function() {
      const tag = this.getAttribute('data-tag');
      const filtered = allMemos.filter(m => (m.tags || []).includes(tag));
      currentPage = 0;
      renderMemosPaged(filtered, currentPage);
    }
  });

  if (window.ViewImage) ViewImage.init('.bb-cont img');
  if (window.Lately) Lately.init({ target: '.datatime' });

  // --- 首页修复逻辑 ---
  document.querySelectorAll('.attach-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      const memoId = this.getAttribute('data-id');
      const memo = allMemos.find(m => m.id == memoId);
      if (memo && memo.resourceList) {
        
        // 斩草除根：清理一切残留
        document.querySelectorAll('.temp-img-box').forEach(el => el.remove());

        let temp = document.createElement('div');
        temp.className = 'temp-img-box';
        temp.id = 'temp-v-' + memoId; 
        temp.style.display = 'none'; 
        document.body.appendChild(temp);
        
        memo.resourceList.forEach(res => {
          let link = res.externalLink || res.publicUrl || res.filename || '';
          if (link.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
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

document.addEventListener('DOMContentLoaded', () => {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos).then(res => res.json()).then(data => {
      
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
});