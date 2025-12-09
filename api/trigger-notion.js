export default async function handler(req, res) {
  // 仅允许 GET/POST 请求作为触发入口
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }

  const secret = (req.query && req.query.secret) || req.headers['x-trigger-secret'];
  const expected = process.env.TRIGGER_SECRET;
  if (!expected) {
    console.error('TRIGGER_SECRET not configured in environment');
    return res.status(500).send('Server misconfiguration');
  }
  if (!secret || secret !== expected) {
    return res.status(403).send('Forbidden');
  }

  const owner = 'cosine00';
  const repo = 'hug00';
  const eventType = 'notion_sync'; // 与你的 workflow repository_dispatch types 保持一致

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not configured');
    return res.status(500).send('Server misconfiguration');
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const body = JSON.stringify({ event_type: eventType });

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body
    });

    if (r.status === 204) {
      return res.status(200).send('Workflow dispatched');
    }

    const text = await r.text();
    console.error('GitHub API error', r.status, text);
    return res.status(502).send(`GitHub API error: ${r.status} ${text}`);
  } catch (e) {
    console.error('Request failed', e);
    return res.status(500).send('Internal error');
  }
}
