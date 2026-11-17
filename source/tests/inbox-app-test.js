// App-side test of '알림 자동 받기' against a mock server that follows sync-worker/INBOX.md exactly.
const fs = require('fs'); const [htmlPath] = process.argv.slice(2);
const code = [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
const subtle = globalThis.crypto.subtle, b64 = u8 => Buffer.from(u8).toString('base64');
const store = new Map(); // id -> {oh, pub, msgs: Map}
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const sha = async s => b64(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(s))));
let seq = 0;
async function server(url, init = {}) {
  const u = new URL(url), p = u.pathname, h = init.headers || {}, tok = h['X-Owner-Token'];
  let m;
  if ((m = p.match(/^\/inbox\/([\w-]+)\/key$/)) && init.method === 'PUT') { const cur = store.get(m[1]), oh = await sha(tok); if (cur && cur.oh !== oh) return J({ error: 'forbidden' }, 403); store.set(m[1], { oh, pub: JSON.parse(init.body).pub, msgs: cur ? cur.msgs : new Map() }); return J({ ok: true }); }
  if ((m = p.match(/^\/in\/([\w-]+)$/)) && init.method === 'POST') {
    const box = store.get(m[1]); if (!box) return J({ error: 'not_found' }, 404);
    let text = String(init.body || ''); try { const j = JSON.parse(text); text = (j.title ? j.title + ' ' : '') + (j.text || j.message || j.body || j.content || ''); } catch {}
    text = text.trim(); if (!text) return J({ error: 'empty' }, 400);
    const pub = await subtle.importKey('jwk', box.pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
    const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey)), id = `${Date.now()}-${++seq}`;
    box.msgs.set(id, { id, at: new Date().toISOString(), epk: b64(epk), iv: b64(iv), ct: b64(ct) }); return J({ ok: true });
  }
  if ((m = p.match(/^\/inbox\/([\w-]+)$/))) {
    const box = store.get(m[1]); if (!box) return J({ error: 'not_found' }, 404); if (box.oh !== await sha(tok)) return J({ error: 'forbidden' }, 403);
    if (init.method === 'DELETE') { store.delete(m[1]); return J({ ok: true }); }
    return J({ items: [...box.msgs.values()] });
  }
  if ((m = p.match(/^\/inbox\/([\w-]+)\/ack$/))) { const box = store.get(m[1]); if (!box || box.oh !== await sha(tok)) return J({ error: 'forbidden' }, 403); let n = 0; for (const id of JSON.parse(init.body).ids) if (box.msgs.delete(id)) n++; return J({ ok: true, deleted: n }); }
  return J({ error: 'not_found' }, 404);
}
const fetchMock = async (url, init) => { const s = String(url); if (s.includes('/in/') || s.includes('/inbox/')) return server(s, init); throw new Error('blocked ' + s); };
const ls = new Map(); const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
const els = {}; const mk = () => new Proxy({ innerHTML: '', hidden: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 600, classList: { add() {}, remove() {} } }, { get(t, k) { if (k in t) return t[k]; if (k === 'querySelector') return () => mk(); if (k === 'querySelectorAll') return () => []; if (k === 'closest') return () => null; return () => mk(); }, set(t, k, v) { t[k] = v; return true; } });
const document = { querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], addEventListener() {}, createElement: () => mk(), head: mk(), visibilityState: 'visible' };
const window = { __MOA_TEST__: true, addEventListener() {}, crypto: globalThis.crypto };
const location = { hash: '', pathname: '/moa-money/household/', search: '', hostname: 'converseddululu.github.io', origin: 'https://converseddululu.github.io' };
const app = new Function('localStorage', 'document', 'window', 'location', 'history', 'fetch', code + `
  return { S, loadWS, render, inboxEnable, inboxPoll, inboxTest, inboxUrl, inboxDisable, mergeDocs };`)(localStorage, document, window, location, { replaceState() {} }, fetchMock);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const phone = (text, as = 'text') => fetchMock(app.inboxUrl(), { method: 'POST', headers: { 'Content-Type': as === 'json' ? 'application/json' : 'text/plain' }, body: as === 'json' ? JSON.stringify({ title: '신한카드', text }) : text });
(async () => {
  app.loadWS('mine'); await app.inboxEnable();
  ok(app.S.d.inbox && app.S.d.inbox.id && app.inboxUrl().includes('/in/'), 'inbox created: ' + app.inboxUrl().replace(/\/in\/.*/, '/in/…'));
  const stored = JSON.stringify([...store.values()][0]); ok(!stored.includes('"d"'), 'server holds only the public key');
  await app.inboxTest(); ok(app.S.d.tx.length === 0, 'test notification arrives and is not added to the ledger');
  await phone('[Web발신]\n신한카드(1234)승인 김*수 6,100원(일시불)11/14 08:42 스타벅스 역삼점 누적512,300원');
  await phone('KB국민카드5678승인 김*수님 23,400원 일시불 11/14 19:05 쿠팡이츠 누적535,700원', 'json');
  await phone('[Web발신] 이번 달 혜택을 확인하세요! 신한카드 이벤트');
  await phone('[Web발신]\n[하나은행] 11/15 10:00 123-***-456789 입금 45,000 잔액 1,909,200 당근페이');
  const raw = JSON.stringify([...[...store.values()][0].msgs.values()]); ok(!/스타벅스|쿠팡/.test(raw), 'stored messages are encrypted (no merchant names in server data)');
  await app.inboxPoll(false);
  const memos = app.S.d.tx.map(t => `${t.memo}:${t.type}:${t.amount}`).sort();
  ok(app.S.d.tx.length === 3 && memos.join(',').includes('스타벅스 역삼점:out:6100') && memos.join(',').includes('당근페이:in:45000'), 'auto-added 3 (ad skipped): ' + memos.join(', '));
  ok(app.S.d.tx.every(t => t.id.startsWith('in-') && /자동/.test(t.method)), 'auto entries marked (id in-*, method · 자동)');
  ok([...store.values()][0].msgs.size === 0, 'all processed messages acknowledged and deleted on server');
  await phone('KB국민카드5678승인 김*수님 23,400원 일시불 11/14 19:05 쿠팡이츠 누적535,700원'); await app.inboxPoll(); ok(app.S.d.tx.length === 3, 'same notification twice is not added again');
  await phone('[Web발신]\n현대카드 승인취소 김*수 6,100원 11/15 18:02 스타벅스 역삼점'); await app.inboxPoll(); ok(!app.S.d.tx.some(t => t.memo.startsWith('스타벅스')), 'cancellation removes the matching auto entry');
  for (const t of ['ledger', 'data', 'home']) { app.S.tab = t; app.render(); const h = document.querySelector('#v-' + t).innerHTML; ok(!/undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder|id|for|href)="[^"]*"/g, '')), `${t} view renders`); }
  ok(document.querySelector('#v-ledger').innerHTML.includes('알림으로 자동으로 들어온 내역'), 'ledger shows auto-added card');
  const m2 = app.mergeDocs({ ...app.S.d, inbox: { at: 1, removed: true } }, app.S.d); ok(m2.inbox && m2.inbox.id, 'sync merge keeps the newer inbox config');
  await app.inboxDisable(); ok(app.S.d.inbox.removed && store.size === 0, 'turning off deletes the server inbox');
})();
