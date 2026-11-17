// 알림 받은편지함 (약속은 INBOX.md)
// 휴대폰 자동화가 보낸 카드·은행 알림을 가계부의 공개키로 바로 암호화해 잠깐 보관하고,
// 가계부가 가져가 지우거나 7일이 지나면 없어져요. 원문과 토큰은 저장하지도, 로그로 남기지도 않아요.
//
// PUT    /inbox/:id/key  X-Owner-Token, { pub: ECDH P-256 공개키 JWK } → 받은편지함 만들기/키 바꾸기
// POST   /in/:id         알림 하나 (text/plain 원문 · JSON {text|message|body|content, title} · form)
// GET    /inbox/:id      X-Owner-Token → { items: [{ id, at, epk, iv, ct }] } (오래된 순)
// POST   /inbox/:id/ack  X-Owner-Token, { ids: [...] } → { ok, deleted }
// DELETE /inbox/:id      X-Owner-Token → 받은편지함 통째로 지우기

const INBOX_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Owner-Token',
  'Access-Control-Max-Age': '86400'
};
const MAX_TEXT = 4000;       // 알림 한 개 최대 글자 수
const MAX_RAW = 65536;       // 요청 본문 최대 바이트 (form 인코딩된 한글 4000자도 들어가요)
const MAX_PENDING = 300;     // 쌓아 둘 수 있는 알림 수
const MAX_ACK = 1000;        // ack 한 번에 받는 id 수
const TTL = 7 * 24 * 60 * 60 * 1000;
const MSG_ID = /^\d{13}-[0-9a-f]{16}$/;
const TEXT_FIELDS = ['text', 'message', 'body', 'content'];
const EC = { name: 'ECDH', namedCurve: 'P-256' };

const out = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...INBOX_CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const res = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

async function ownerHash(req) {
  const t = req.headers.get('X-Owner-Token') || '';
  if (t.length < 20 || t.length > 512) return null;
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
}

// 본문을 최대 cap 바이트까지만 읽어요. 넘으면 null.
async function readCapped(req, cap) {
  if (Number(req.headers.get('Content-Length')) > cap) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return buf;
}

async function readJson(req) {
  const raw = await readCapped(req, MAX_RAW);
  if (!raw) return { error: 'too_large', status: 413 };
  try { return { value: JSON.parse(new TextDecoder().decode(raw)) }; } catch { return { error: 'bad_json', status: 400 }; }
}

// --- 알림 본문 꺼내기 -------------------------------------------------------

// { text|message|body|content, title } → "title text". 이름은 대소문자를 가리지 않아요.
// 아는 이름이 하나도 없으면 문자열 값을 모두 이어 붙여요(자동화 설정 실수 대비).
function pickText(obj) {
  const low = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (!(lk in low) && typeof v === 'string') low[lk] = v.trim();
  }
  let text = '';
  for (const k of TEXT_FIELDS) if ((text = low[k] || '')) break;
  const title = low.title || '';
  if (!text && !title) return Object.values(low).filter(Boolean).join(' ');
  return title && text ? title + ' ' + text : text || title;
}

// 문자열 안의 줄바꿈 같은 제어문자를 이스케이프해요. (MacroDroid 템플릿에 알림 원문을 그대로 넣으면 생겨요)
function escapeCtlInStrings(s) {
  let r = '', inStr = false, esc = false;
  for (const ch of s) {
    if (!inStr) { if (ch === '"') inStr = true; r += ch; continue; }
    if (esc) { esc = false; r += ch; continue; }
    if (ch === '\\') { esc = true; r += ch; continue; }
    if (ch === '"') { inStr = false; r += ch; continue; }
    const c = ch.charCodeAt(0);
    if (c < 0x20) r += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '\\u' + c.toString(16).padStart(4, '0');
    else r += ch;
  }
  return r;
}

const unescapeLoose = (t) =>
  t.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_, c) =>
    c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[c] || c);

// 망가진 JSON도 최대한 읽어요: 그대로 → 제어문자 고쳐서 → 아는 키만 골라서.
function parseLooseJson(s) {
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(escapeCtlInStrings(s)); } catch {}
  const o = {};
  for (const k of [...TEXT_FIELDS, 'title']) {
    const m = s.match(new RegExp('"' + k + '"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"[A-Za-z0-9_]+"\\s*:|\\}\\s*$)', 'i'));
    if (m) o[k] = unescapeLoose(m[1]);
  }
  return Object.keys(o).length ? o : undefined;
}

async function readText(req) {
  const raw = await readCapped(req, MAX_RAW);
  if (!raw) return { error: 'too_large', status: 413 };
  const s = new TextDecoder().decode(raw);
  const ctype = req.headers.get('Content-Type') || '';
  const ct = ctype.toLowerCase();
  let text = null;
  if (ct.includes('application/x-www-form-urlencoded')) {
    const o = {};
    for (const [k, v] of new URLSearchParams(s)) if (!(k in o)) o[k] = v;
    text = pickText(o);
  } else if (ct.includes('multipart/form-data')) {
    try {
      const fd = await new Response(raw, { headers: { 'Content-Type': ctype } }).formData();
      const o = {};
      for (const [k, v] of fd) if (typeof v === 'string' && !(k in o)) o[k] = v;
      text = pickText(o);
    } catch { text = null; }
  } else {
    const t = s.trim();
    if (ct.includes('json') || (t.startsWith('{') && t.endsWith('}'))) {
      const v = parseLooseJson(t);
      if (typeof v === 'string') text = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) text = pickText(v);
    }
  }
  text = (text == null ? s : text).trim();
  if (!text) return { error: 'empty', status: 400 };
  if (text.length > MAX_TEXT) return { error: 'too_long', status: 413 };
  return { text };
}

// 공개키 JWK 검사: EC P-256, 비밀키(d) 없이, 곡선 위의 점이어야 해요.
async function cleanPub(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  if (j.kty !== 'EC' || j.crv !== 'P-256' || 'd' in j) return null;
  const B = /^[A-Za-z0-9_-]{43}$/;
  if (typeof j.x !== 'string' || typeof j.y !== 'string' || !B.test(j.x) || !B.test(j.y)) return null;
  const pub = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
  try { await crypto.subtle.importKey('jwk', pub, EC, true, []); } catch { return null; }
  return pub;
}

// --- 바깥 요청 처리 (메인 Worker) --------------------------------------------

async function toInbox(env, id, op, payload) {
  const stub = env.INBOX.get(env.INBOX.idFromName(id));
  const r = await stub.fetch('https://inbox/' + op, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return new Response(await r.text(), { status: r.status, headers: { ...INBOX_CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function handleInbox(req, env, path) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: INBOX_CORS });
  try {
    let m = path.match(/^\/in\/([A-Za-z0-9_-]{22,64})\/?$/);
    if (m) {
      if (req.method !== 'POST') return out({ error: 'method_not_allowed' }, 405);
      if (!env.INBOX) return out({ error: 'unavailable' }, 503);
      const r = await readText(req);
      if (r.error) return out({ error: r.error }, r.status);
      return await toInbox(env, m[1], 'put', { text: r.text });
    }
    m = path.match(/^\/inbox\/([A-Za-z0-9_-]{22,64})(\/key|\/ack)?$/);
    if (!m) return out({ error: 'not_found' }, 404);
    const [, id, sub = ''] = m;
    const method = sub === '/key' ? 'PUT' : sub === '/ack' ? 'POST' : null;
    if (method ? req.method !== method : req.method !== 'GET' && req.method !== 'DELETE') return out({ error: 'method_not_allowed' }, 405);
    if (!env.INBOX) return out({ error: 'unavailable' }, 503);
    const th = await ownerHash(req);
    if (!th) return out({ error: 'forbidden' }, 403);

    if (sub === '/key') {
      const b = await readJson(req);
      if (b.error) return out({ error: b.error }, b.status);
      const pub = await cleanPub(b.value && b.value.pub);
      if (!pub) return out({ error: 'bad_key' }, 400);
      return await toInbox(env, id, 'register', { th, pub });
    }
    if (sub === '/ack') {
      const b = await readJson(req);
      if (b.error) return out({ error: b.error }, b.status);
      const ids = b.value && b.value.ids;
      if (!Array.isArray(ids) || ids.length > MAX_ACK) return out({ error: 'bad_request' }, 400);
      return await toInbox(env, id, 'ack', { th, ids: ids.filter((x) => typeof x === 'string' && MSG_ID.test(x)) });
    }
    return await toInbox(env, id, req.method === 'GET' ? 'list' : 'destroy', { th });
  } catch {
    // 본문·토큰이 섞일 수 있어서 오류 내용은 남기지 않아요.
    return out({ error: 'server_error' }, 500);
  }
}

// --- Durable Object: 받은편지함 하나 ------------------------------------------
// 저장 키: 'meta' → { th: 토큰 해시, pub: 공개키 JWK, at }
//          'm:<13자리 ms>-<16자리 hex>' → { id, at, epk, iv, ct }  (키 순서 = 받은 순서)

export class Inbox {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(req) {
    const op = new URL(req.url).pathname.slice(1);
    const a = await req.json();
    const st = this.storage;

    if (op === 'put') {
      // 암호화를 먼저 끝내고, 그다음 저장소 작업만 이어서 해요(사이에 다른 요청이 끼어들지 않게).
      const meta0 = await st.get('meta');
      if (!meta0) return res({ error: 'not_found' }, 404);
      const enc = await encryptFor(meta0.pub, a.text);
      const [meta, pending] = await Promise.all([st.get('meta'), st.list({ prefix: 'm:', limit: MAX_PENDING })]);
      if (!meta) return res({ error: 'not_found' }, 404);
      if (pending.size >= MAX_PENDING) return res({ error: 'too_many' }, 429);
      const ts = Date.now();
      const id = String(ts).padStart(13, '0') + '-' + hex(crypto.getRandomValues(new Uint8Array(8)));
      await st.put('m:' + id, { id, at: new Date(ts).toISOString(), ...enc });
      if ((await st.getAlarm()) == null) await st.setAlarm(ts + TTL);
      return res({ ok: true });
    }

    const meta = await st.get('meta');
    if (op === 'register') {
      if (meta && meta.th !== a.th) return res({ error: 'forbidden' }, 403);
      await st.put('meta', { th: a.th, pub: a.pub, at: meta ? meta.at : new Date().toISOString() });
      return res({ ok: true });
    }
    if (op === 'destroy') {
      if (!meta) return res({ ok: true });
      if (meta.th !== a.th) return res({ error: 'forbidden' }, 403);
      await st.deleteAlarm();
      await st.deleteAll();
      return res({ ok: true });
    }
    if (!meta) return res({ error: 'not_found' }, 404);
    if (meta.th !== a.th) return res({ error: 'forbidden' }, 403);

    if (op === 'list') {
      const list = await st.list({ prefix: 'm:', limit: MAX_PENDING });
      return res({ items: [...list.values()].map(({ id, at, epk, iv, ct }) => ({ id, at, epk, iv, ct })) });
    }
    if (op === 'ack') {
      const keys = [...new Set(a.ids)].map((x) => 'm:' + x);
      let deleted = 0;
      for (let i = 0; i < keys.length; i += 128) deleted += await st.delete(keys.slice(i, i + 128));
      return res({ ok: true, deleted });
    }
    return res({ error: 'not_found' }, 404);
  }

  // 7일 지난 알림을 지우고, 남은 것 중 가장 오래된 것에 맞춰 다음 알람을 걸어요.
  async alarm() {
    const st = this.storage;
    const cutoff = Date.now() - TTL;
    const list = await st.list({ prefix: 'm:' });
    const expired = [];
    let next = null;
    for (const k of list.keys()) {
      const ts = Number(k.slice(2, 15));
      if (ts <= cutoff) expired.push(k);
      else { next = ts; break; }
    }
    for (let i = 0; i < expired.length; i += 128) await st.delete(expired.slice(i, i + 128));
    if (next != null) await st.setAlarm(next + TTL);
  }
}

// 메시지마다 임시 ECDH 키쌍 → 등록된 공개키와 AES-GCM 256 키 → 12바이트 iv로 UTF-8 원문 암호화
async function encryptFor(pubJwk, text) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, EC, false, []);
  const eph = await crypto.subtle.generateKey(EC, false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const epk = await crypto.subtle.exportKey('raw', eph.publicKey);
  return { epk: b64(epk), iv: b64(iv), ct: b64(ct) };
}
