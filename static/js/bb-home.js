/*
Last Modified time : 20240704 by Copilot
*/
let bbMemo = {
  memos: '/memos.json',
  limit: 20, // 每页条数
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
.tag-span{color:#42b983;font-weight:bold;background:#e6f9f0;border-radius:4px;padding:2px 6px;margin-right:4px;display:inline-block;}
.tag-span.tag-filter {
  cursor: pointer;
  text-decoration: underline;
}
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
.item-twikoo {
  margin: 2rem 0 0 0;
}
.d-none {
  display: none !important;
}
.emoji-reaction-bar {
  margin-bottom: 0.5em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.bb-load {
  text-align: center;
  margin: 2em 0 1em 0;
}
.bb-load button {
  background: #fff;
  color: #42b983;
  border: 1px solid #42b983;
  border-radius: 4px;
  padding: 8px 24px;
  font-size: 1em;
  cursor: pointer;
  transition: background .2s;
}
.bb-load button:hover {
  background: #42b983;
  color: #fff;
}
.bb-cont img,
.resimg img,
.gallery-thumbnail img,
.thumbnail-image {
  max-width: 100%;
  max-height: 320px; /* 可根据需要调整 */
  height: auto;
  width: auto;
  display: block;
  margin: 0.5em 0;
  object-fit: contain;
}
.datacount {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.comment-count {
  margin-left: 4px;
  font-size: 12px;
  color: #800080; /* 紫色文字 */
  background: rgba(255, 255, 255, 0.8);
  border-radius: 8px;
  padding: 0 4px;
}
.datacount:hover svg path {
  fill: #a040a0; /* 悬停时加深紫色 */
}
`
loadCssCode(allCSS);

let allMemos = [];
let currentPage = 0;
let pageSize = parseInt(bbMemo.limit) || 20;

function renderMemosPaged(memos, page) {
  let start = 0;
  let end = (page + 1) * pageSize;
  let showMemos = memos.slice(0, end);
  let result = "";
  // 在 renderMemosPaged 里 result 之前加
  if (memos.length !== allMemos.length) {
    result += `<div class="bb-load"><button id="bb-show-all">显示全部</button></div>`;
  }
  showMemos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return;
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    let tags = (item.tags || []).map(tag => `<span class="tag-span tag-filter" data-tag="${tag}">#${tag}</span>`).join(' ');
    // 不直接展示图片，改为点击按钮后显示
    let attachBtn = '';
    if (item.resourceList && item.resourceList.length > 0) {
      attachBtn = `
        <span class="datacount attach-btn" data-id="${item.id}" title="查看附件图片">
          <svg t="1717750000000" class="icon" viewBox="0 0 1024 1024" width="20" height="20">
            <path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="#42b983"/>
          </svg> 查看图片
        </span>
      `;
    }
    // 去除 content 中的 #标签
    let contentText = item.content.replace(/#[^\s#]+/g, '').replace(/^\s+|\s+$/g, '');
    // 把标签HTML插入到正文最前面
    let contentWithTags = `${tags} ${contentText.replace(/\n/g, '  \n')}`; // 注意这里
    let content = window.marked ? marked.parse(contentWithTags) : contentWithTags;

    // 标签和正文同一行
    let tagsAndContent = `${tags} ${content}`;

    // emaction表情条
    let emojiBar = `<span class="emoji-reaction-bar" style="display:inline-flex;vertical-align:middle;"><emoji-reaction theme="system" endpoint="https://api-emaction.immmmm.com" reacttargetid="memo-${item.id}" style="line-height:normal;display:inline-flex;"></emoji-reaction></span>`;
    // 评论按钮和评论框
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
          <div class="bb-info" style="position:relative;">
            ${emojiBar}&nbsp;&nbsp;<span class="datatime" title="${dateStr}">${dateStr}</span>
            ${attachBtn}
          </div>
          <div class="item-attach attach-${item.id} d-none"></div>
        </div>
      </li>
    `;
  });
  let html = `<section class="bb-timeline"><ul>${result}</ul></section>`;
  // 加载更多按钮
  if (end < memos.length) {
    html += `<div class="bb-load"><button id="bb-load-more">加载更多</button></div>`;
  }
  document.querySelector(bbMemo.domId).innerHTML = html;

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

  // 附件图片按钮点击后显示/收回图片缩略图
  document.querySelectorAll('.attach-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const memoId = btn.getAttribute('data-id');
      const attachDom = document.querySelector('.attach-' + memoId);
      if (attachDom.classList.contains('d-none')) {
        // 显示所有图片缩略图，布局自适应
        let imgHtml = '';
        const memo = allMemos.find(m => m.id == memoId);
        if (memo && memo.resourceList && memo.resourceList.length > 0) {
          let imgUrl = '';
          let resImgLength = 0;
          memo.resourceList.forEach(res => {
            let restype = res.type ? res.type.slice(0,5) : '';
            let resLink = res.externalLink || res.publicUrl || res.filename || '';
            if(restype === 'image' || resLink.match(/\.(jpg|jpeg|png|gif|webp)$/i)){
              imgUrl += `<figure class="gallery-thumbnail"><img class="img thumbnail-image" src="${resLink}" data-view-image /></figure>`;
              resImgLength++;
            }
          });
          if(imgUrl){
            let resImgGrid = "";
            if(resImgLength === 1){
              resImgGrid = " grid grid-2";
            } else {
              resImgGrid = " grid grid-"+resImgLength;
            }
            imgHtml = `<div class="resimg${resImgGrid}">${imgUrl}</div>`;
          }
        }
        attachDom.innerHTML = imgHtml;
        attachDom.classList.remove('d-none');
        // 初始化 ViewImage（如果需要）
        if (window.ViewImage) ViewImage.init('.attach-' + memoId + ' img');
      } else {
        // 收回所有缩略图
        attachDom.innerHTML = '';
        attachDom.classList.add('d-none');
      }
    });
  });

  // 初始化 emaction（表情）组件
  if (window.emactionInit) {
    emactionInit();
  }

  // 加载更多按钮事件
  let loadMoreBtn = document.getElementById('bb-load-more');
  if (loadMoreBtn) {
    loadMoreBtn.onclick = function() {
      currentPage++;
      renderMemosPaged(allMemos, currentPage);
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

document.addEventListener('DOMContentLoaded', function() {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos)
      .then(res => res.json())
      .then(data => {
        allMemos = data;
        currentPage = 0;
        renderMemosPaged(allMemos, currentPage);
      });
  }
});