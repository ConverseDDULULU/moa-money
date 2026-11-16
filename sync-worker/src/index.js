// 모아 가계부 동기화 서버
// 브라우저에서 암호화한 덩어리만 보관해요. 열쇠는 링크(#) 안에만 있어서 서버는 내용을 읽을 수 없어요.
// GET    /v1/:id  → { v, iv, data, at }
// PUT    /v1/:id  → body { base, iv, data }, 헤더 X-Write-Token (처음 쓴 사람의 토큰과 같아야 함)
// DELETE /v1/:id  → 헤더 X-Write-Token
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Write-Token',
  'Access-Control-Max-Age': '86400'
};
const MAX_DATA = 2_700_000; // 암호문(base64) 최대 길이, 약 2MB

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function sha256b64(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/v1\/([A-Za-z0-9_-]{16,64})$/);
    if (!m) return json({ error: 'not_found' }, 404);
    const key = 'doc:' + m[1];
    const cur = await env.MOA_SYNC.get(key, 'json');

    if (req.method === 'GET') return cur ? json({ v: cur.v, iv: cur.iv, data: cur.data, at: cur.at }) : json({ error: 'not_found' }, 404);

    const tok = req.headers.get('X-Write-Token') || '';
    if (tok.length < 20) return json({ error: 'forbidden' }, 403);
    const th = await sha256b64(tok);
    if (cur && cur.wh !== th) return json({ error: 'forbidden' }, 403);

    if (req.method === 'DELETE') { if (cur) await env.MOA_SYNC.delete(key); return json({ ok: true }); }
    if (req.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
    if (typeof body.data !== 'string' || typeof body.iv !== 'string' || body.data.length > MAX_DATA || body.iv.length > 64) return json({ error: 'bad_request' }, 400);
    const v = cur ? cur.v : 0;
    if ((Number(body.base) || 0) !== v) return json({ error: 'conflict', v }, 409);
    const doc = { v: v + 1, iv: body.iv, data: body.data, at: new Date().toISOString(), wh: th };
    await env.MOA_SYNC.put(key, JSON.stringify(doc));
    return json({ v: doc.v, at: doc.at });
  }
};
