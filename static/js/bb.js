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

function renderMemos(memos) {
  let result = "";
  memos.forEach(item => {
    if (!item || !item.content || !item.createdTs) return; // 跳过无效条目
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    // 标签绿色并在最前
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
        <div class="itemdiv">
          <div class="datacont">
            <span class="tag-span">${tags}</span>
            ${content}
            ${resources}
          </div>
          <div class="datatime" title="${dateStr}">${dateStr}</div>
        </div>
      </li>
    `;
  });
  let html = `<div class="timeline"><ul>${result}</ul></div>`;
  document.querySelector(bbMemo.domId).innerHTML = html;
  if (window.ViewImage) ViewImage.init('.datacont img');
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
});