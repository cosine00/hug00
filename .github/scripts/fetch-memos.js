const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const MEMOS_API = 'https://i.hux.ink:5233/api/v1/memo?creatorId=1&rowStatus=NORMAL&limit=5000';

(async () => {
  const res = await fetch(MEMOS_API);
  const json = await res.json();
  const data = json.data || json;

  // 只保留页面需要的字段
  const memos = data.map(item => ({
    id: item.id,
    content: item.content,
    createdTs: item.createdTs,
    resourceList: item.resourceList || [],
    tags: item.tags || [],
    // 可扩展其它字段
  }));

  // 保存到 static/memos.json
  const outPath = path.join(__dirname, '../../static/memos.json');
  fs.writeFileSync(outPath, JSON.stringify(memos, null, 2), 'utf-8');
})();