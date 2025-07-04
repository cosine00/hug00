/*
Last Modified time : 20240704 by Copilot
*/
let bbMemo = {
  memos: '/memos.json',
  limit: '10',
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
.bb-timeline .bb-cont{overflow-x:hidden;overflow-y:auto;margin-top:.5rem;max-height:50vh;}
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
.resimg.grid{display:grid;box-sizing:border-box;margin:4px 0 0;width:calc(100%* 2 / 3);grid-template-columns:repeat(3,1fr);grid-template-rows:auto;gap:4px;}
.resimg.grid-2{width:80%;grid-template-columns:repeat(2,1fr);}
.resimg.grid-4{width:calc(80% * 2 / 3);grid-template-columns:repeat(2,1fr);}
.resimg.grid figure.gallery-thumbnail{position:relative;padding-top:100%;width:100%;height:0;cursor:zoom-in;}
.resimg figure{max-height:50%;text-align:left;}
.resimg figure img{max-height:50vh;}
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
  margin: 0.5em 0 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
`
loadCssCode(allCSS);

function renderMemos(memos) {
  let result = "";
  memos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return;
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    let tags = (item.tags || []).map(tag => `<span class="tag-span">#${tag}</span>`).join(' ');
    let resources = '';
    if (item.resourceList && item.resourceList.length > 0) {
      let imgUrl = '';
      let resImgLength = 0;
      item.resourceList.forEach(res => {
        let restype = res.type ? res.type.slice(0,5) : '';
        let resLink = res.externalLink || res.publicUrl || res.filename || '';
        if(restype === 'image' || resLink.match(/\.(jpg|jpeg|png|gif|webp)$/i)){
          imgUrl += `<figure class="gallery-thumbnail"><img class="img thumbnail-image" src="${resLink}" /></figure>`;
          resImgLength++;
        }
      });
      if(imgUrl){
        let resImgGrid = "";
        if(resImgLength !== 1){resImgGrid = " grid grid-"+resImgLength}
        resources = `<div class="resimg${resImgGrid}">${imgUrl}</div>`;
      }
    }
    let content = window.marked ? marked.parse(item.content) : item.content;
    // 表情条（emaction）
    let emojiBar = `<div class="emoji-reaction-bar"><emoji-reaction theme="system" endpoint="https://api-emaction.immmmm.com" reacttargetid="memo-${item.id}" style="line-height:normal;display:inline-flex;"></emoji-reaction></div>`;
    // 评论按钮和评论框
    let datacountDOM = `
      <span class="datacount" data-twienv="${bbMemo.twiEnv}" data-id="${item.id}" title="评论">
        <svg t="1717750000000" class="icon" viewBox="0 0 1024 1024" width="20" height="20">
          <path d="M464 896c-8.8 0-17.6-3.6-24-10.4-13.2-13.2-13.2-34.8 0-48l70.4-70.4C617.6 755.2 704 650.4 704 528c0-123.2-100.8-224-224-224S256 404.8 256 528c0 122.4 86.4 227.2 193.6 289.6l70.4 70.4c13.2 13.2 13.2 34.8 0 48-6.4 6.8-15.2 10.4-24 10.4z" fill="#42b983"/>
        </svg>
      </span>
    `;
    result += `
      <li>
        <div class="bb-item" style="position:relative;">
          <div class="bb-cont">
            ${tags}
            ${content}
            ${resources}
            ${emojiBar}
          </div>
          <div class="bb-info" style="position:relative;">
            <span class="datatime" title="${dateStr}">${dateStr}</span>
            ${datacountDOM}
          </div>
          <div class="item-twikoo twikoo-${item.id} d-none">
            <div id="twikoo-${item.id}"></div>
          </div>
        </div>
      </li>
    `;
  });
  let html = `<section class="bb-timeline"><ul>${result}</ul></section>`;
  document.querySelector(bbMemo.domId).innerHTML = html;
  if (window.ViewImage) ViewImage.init('.bb-cont img');
  if (window.Lately) Lately.init({ target: '.datatime' });

  // 评论按钮点击后加载 twikoo
  document.querySelectorAll('.datacount').forEach(btn => {
    btn.addEventListener('click', function() {
      const memoId = btn.getAttribute('data-id');
      const twikooDom = document.querySelector('.twikoo-' + memoId);
      if (twikooDom.classList.contains('d-none')) {
        // 先收起其它已展开的
        document.querySelectorAll('.item-twikoo').forEach(item => item.classList.add('d-none'));
        twikooDom.classList.remove('d-none');
        // 滚动到评论区
        let domClass = document.getElementsByClassName('twikoo-' + memoId);
        window.scrollTo({
          top: domClass[0].offsetTop - 30,
          behavior: "smooth"
        });
        // 初始化评论
        if (!twikooDom.hasAttribute('data-inited')) {
          if (window.twikoo) {
            twikoo.init({
              envId: bbMemo.twiEnv,
              el: '#twikoo-' + memoId,
              path: '/m/' + memoId,
            });
          }
          twikooDom.setAttribute('data-inited', '1');
        }
      } else {
        twikooDom.classList.add('d-none');
      }
    });
  });

  // 初始化 emaction（表情）组件
  if (window.emactionInit) {
    emactionInit();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos)
      .then(res => res.json())
      .then(data => renderMemos(data));
  }
});