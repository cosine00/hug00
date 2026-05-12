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
.tag-span{color:#42b983;font-weight:bold;background:#e6f9f0;border-radius:4px;padding:2px 6px;margin-right:4px;display:inline-block;}
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
      attachBtn = `<span class="datacount attach-btn" data-id="${item.id}" title="查看图片"><svg t="1717750000000" viewBox="0 0 1024 1024" width="20" height="20"><path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="#42b983"/></svg>查看图片</span>`;
    }

    let contentText = item.content.replace(/#[^\s#]+/g, '').trim();
    let contentWithTags = `${tags} ${contentText.replace(/\n/g, '  \n')}`;
    let content = window.marked ? marked.parse(contentWithTags) : contentWithTags;

    result += `
      <li>
        <div class="bb-item" style="position:relative;">
          <div class="bb-cont">${content}</div>
          <div class="bb-info" style="position:relative;">
            <div style="display:inline-flex; align-items:center; gap:12px;">
              <div class="comment-pill-btn twikoo-badge-${item.id}" data-id="${item.id}" data-twienv="${bbMemo.twiEnv}" title="点击评论">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                <span class="count-num" style="display: none; padding-top: 1px;">0</span>
              </div>
              
              <div style="display:inline-flex;">
                <emoji-reaction theme="system" endpoint="https://api-emaction.immmmm.com" reacttargetid="memo-${item.id}" style="line-height:normal;"></emoji-reaction>
              </div>
            </div>
            &nbsp;&nbsp;<span class="datatime" title="${dateStr}">${dateStr}</span>
            ${item.isPinned ? `<span style="display:inline-flex; align-items:center; justify-content:center; gap:4px; color:#9c27b0; border:1px solid rgba(156, 39, 176, 0.3); font-size:13px; padding:2px 8px; border-radius:14px; height:26px; box-sizing:border-box; margin-left:8px;"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>置顶</span>` : ''}
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

  document.querySelectorAll('.comment-pill-btn').forEach(btn => {
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