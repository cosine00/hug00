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

function renderMemos(memos) {
  let html = `<div class="timeline"><ul>`;
  memos.forEach(item => {
    // 时间格式
    let date = new Date(item.createdTs * 1000);
    let dateStr = date.toLocaleString();
    // 标签
    let tags = (item.tags || []).map(tag => `<span class="tag-span">#${tag}</span>`).join(' ');
    // 资源（图片等）
    let resources = '';
    if (item.resourceList && item.resourceList.length > 0) {
      resources = `<div class="resimg grid">` +
        item.resourceList.map(res =>
          `<figure class="gallery-thumbnail"><img class="thumbnail-image" src="${res.externalLink || res.publicUrl || res.filename}" alt="img"></figure>`
        ).join('') +
        `</div>`;
    }
    // 内容 markdown 渲染
    let content = window.marked ? marked.parse(item.content) : item.content;

    html += `
      <li>
        <div class="itemdiv">
          <span class="datatime" title="${dateStr}">${dateStr}</span>
          <div class="datacont">${content}${resources}</div>
          <div class="datafrom">${tags}</div>
        </div>
      </li>
    `;
  });
  html += `</ul></div>`;
  document.querySelector(bbMemo.domId).innerHTML = html;
  // 图片点击放大
  if (window.ViewImage) ViewImage.init('.resimg img');
  // 时间美化
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