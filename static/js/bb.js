/*
Last Modified time : 20240704 by Copilot
*/
let bbMemo = {
  memos: '/memos.json', // 只用本地json
  limit: '10',
  creatorId: '1',
  domId: '#bber',
  twiEnv: '', // 如需评论可配置
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
.bb-timeline ul{margin:0;padding:0;}
.bb-timeline ul li{margin-bottom:3rem;list-style-type:none;}
.bb-timeline ul li .bb-cont ul li{margin-bottom:0;}
.bb-timeline .bb-item,.bb-load button{border:1px solid #dcdcdc;border-radius:8px;box-shadow:3px 3px 5px rgba(0,0,0,.1);}
.bb-timeline .bb-item{padding:.6rem 1rem .6rem;font-size:16px;}
.bb-timeline .bb-info{position:relative;margin-top:.5rem;font-size:14px;}
.bb-timeline .datatime{font-size:15px;}
.bb-timeline .bb-cont{overflow-x:hidden;overflow-y:scroll;margin-top:.5rem;max-height:50vh;}
.bb-timeline .bb-cont img[src*=emotion]{display:inline-block;width:auto;}
.bb-timeline p{margin:0;min-height:18px;color:#3b3d42;letter-spacing:1px;line-height:28px;}
.bb-timeline pre{color:#aaa;}
.bb-timeline pre p{display:inline-block;}
.bb-timeline pre p:empty{display:none;}
.bb-cont blockquote{position:relative;margin:0 0 0 1rem;padding:.25rem 2rem;border-left:0 none;}
.bb-cont blockquote::before{position:absolute;top:5px;left:10px;content:'“';font-weight:700;font-size:28px;line-height:2rem;}
.tag-span{color:#42b983;cursor:pointer;}
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
`
loadCssCode(allCSS);

function renderMemos(memos) {
  let result = "";
  memos.forEach(item => {
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
    result += `
      <li>
        <div class="bb-item">
          <div class="bb-cont">${content}${resources}</div>
          <div class="bb-info">
            <span class="datatime" title="${dateStr}">${dateStr}</span>
            <span>${tags}</span>
          </div>
        </div>
      </li>
    `;
  });
  let html = `<section class="bb-timeline"><ul>${result}</ul></section>`;
  document.querySelector(bbMemo.domId).innerHTML = html;
  if (window.ViewImage) ViewImage.init('.bb-cont img');
  if (window.Lately) Lately.init({ target: '.datatime' });
}

document.addEventListener('DOMContentLoaded', function() {
  let bbDom = document.querySelector(bbMemo.domId);
  if (bbDom) {
    bbDom.innerHTML = `<div class="loader"><svg class="circular" viewBox="25 25 50 50"><circle class="path" cx="50" cy="50" r="20" fill="none" stroke-width="2" stroke-miterlimit="10"/></svg></div>`;
    fetch(bbMemo.memos)
      .then(res => res.json())
      .then(data => renderMemos(data));
  }