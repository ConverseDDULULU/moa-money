// 알림 받은편지함 테스트: sync-worker 폴더에서 `node --test test/inbox.test.mjs` (Node 22+)
// 가짜 env(메모리 KV + 최소한의 Durable Object 흉내)로 Worker 모듈을 그대로 불러 시험해요.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import worker, { Inbox } from '../src/index.js';

const BASE = 'https://moa-sync.example';
const subtle = crypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' };
const DAY = 24 * 60 * 60 * 1000;

// ---- 가짜 Cloudflare 환경 ---------------------------------------------------

class MemKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { const v = this.m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
}

// Durable Object storage(KV API)의 필요한 부분만: 값은 structuredClone, list는 키 순서, delete는 128개 제한
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) {
    if (Array.isArray(k)) { const r = new Map(); for (const x of k) if (this.m.has(x)) r.set(x, structuredClone(this.m.get(x))); return r; }
    return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined;
  }
  async put(k, v) {
    if (typeof k === 'object') { const e = Object.entries(k); assert.ok(e.length <= 128); for (const [a, b] of e) this.m.set(a, structuredClone(b)); }
    else this.m.set(k, structuredClone(v));
  }
  async delete(k) {
    if (Array.isArray(k)) { assert.ok(k.length <= 128, 'storage.delete는 한 번에 128개까지'); let n = 0; for (const x of k) if (this.m.delete(x)) n++; return n; }
    return this.m.delete(k);
  }
  async list({ prefix = '', limit = Infinity } = {}) {
    const keys = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
    return new Map(keys.map((k) => [k, structuredClone(this.m.get(k))]));
  }
  async deleteAll() { this.m.clear(); }
  async getAlarm() { return this.alarm; }
  async setAlarm(t) { this.alarm = typeof t === 'number' ? t : t.getTime(); }
  async deleteAlarm() { this.alarm = null; }
}

class FakeDONamespace {
  constructor(cls, env) { this.cls = cls; this.env = env; this.objs = new Map(); }
  idFromName(name) { return { name, toString: () => 'id:' + name }; }
  instance(name) {
    if (!this.objs.has(name)) {
      const storage = new MemStorage();
      this.objs.set(name, { storage, obj: new this.cls({ storage, id: this.idFromName(name) }, this.env) });
    }
    return this.objs.get(name);
  }
  get(id) {
    const inst = this.instance(id.name);
    return { fetch: (url, init) => inst.obj.fetch(new Request(url, init)) };
  }
  // 실제처럼: 알람이 울리면 알람 상태가 비워진 뒤 alarm()이 불려요.
  async fireAlarm(name) { const inst = this.instance(name); inst.storage.alarm = null; await inst.obj.alarm(); }
}

function makeEnv() {
  const env = { MOA_SYNC: new MemKV() };
  env.INBOX = new FakeDONamespace(Inbox, env);
  return env;
}

// ---- 도우미 -----------------------------------------------------------------

const call = (env, method, path, { headers = {}, body, duplex } = {}) =>
  worker.fetch(new Request(BASE + path, { method, headers, body, ...(duplex ? { duplex } : {}) }), env);
const jbody = async (r) => JSON.parse(await r.text());
const rid = (n = 24) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b % 64]).join('');
const TOKEN = 'owner-token-' + rid(20);
const OTHER = 'someone-else-' + rid(20);
const ownerH = (t = TOKEN) => ({ 'X-Owner-Token': t });

async function newKeyPair() {
  const kp = await subtle.generateKey(EC, true, ['deriveKey']);
  const pub = await subtle.exportKey('jwk', kp.publicKey); // 가계부가 등록하는 그대로 (key_ops, ext 포함)
  return { priv: kp.privateKey, pub };
}
const register = (env, id, pub, token = TOKEN) =>
  call(env, 'PUT', `/inbox/${id}/key`, { headers: { ...ownerH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ pub }) });
const post = (env, id, body, contentType) =>
  call(env, 'POST', `/in/${id}`, { headers: contentType ? { 'Content-Type': contentType } : {}, body });
const list = async (env, id, token = TOKEN) => call(env, 'GET', `/inbox/${id}`, { headers: ownerH(token) });
const ack = (env, id, ids, token = TOKEN) =>
  call(env, 'POST', `/inbox/${id}/ack`, { headers: { ...ownerH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });

const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const STD_B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// 가계부가 풀 방식 그대로
async function decrypt(item, priv) {
  const epk = await subtle.importKey('raw', unb64(item.epk), EC, false, []);
  const key = await subtle.deriveKey({ name: 'ECDH', public: epk }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(item.iv) }, key, unb64(item.ct));
  return new TextDecoder().decode(pt);
}

// 서버가 아무것도 로그로 남기지 않는지 지켜봐요.
const logged = [];
const saved = {};
before(() => { for (const k of ['log', 'info', 'warn', 'error', 'debug']) { saved[k] = console[k]; console[k] = (...a) => logged.push([k, a]); } });
after(() => { Object.assign(console, saved); assert.deepEqual(logged, [], 'Worker가 콘솔에 아무것도 남기면 안 돼요'); });

// ---- 테스트 -----------------------------------------------------------------

test('CORS preflight for /inbox and /in', async () => {
  const env = makeEnv();
  for (const p of [`/inbox/${rid()}`, `/inbox/${rid()}/key`, `/inbox/${rid()}/ack`, `/in/${rid()}`]) {
    const r = await call(env, 'OPTIONS', p);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(r.headers.get('Access-Control-Allow-Methods'), 'GET,POST,PUT,DELETE,OPTIONS');
    assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type,X-Owner-Token');
  }
  const r = await post(env, rid(), 'x', 'text/plain');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(r.headers.get('Content-Type'), 'application/json');
});

test('PUT /inbox/{id}/key: create, rotate with same token, 403 other token, 400 bad keys', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub } = await newKeyPair();
  let r = await register(env, id, pub);
  assert.equal(r.status, 200);
  assert.deepEqual(await jbody(r), { ok: true });

  const meta = env.INBOX.instance(id).storage.m.get('meta');
  assert.notEqual(meta.th, TOKEN);
  assert.ok(!JSON.stringify(meta).includes(TOKEN), '토큰 원문은 저장하지 않아요');
  assert.deepEqual(meta.pub, { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y });

  const k2 = await newKeyPair();
  r = await register(env, id, k2.pub);
  assert.equal(r.status, 200, '같은 토큰이면 키를 바꿀 수 있어요');
  assert.equal(env.INBOX.instance(id).storage.m.get('meta').pub.x, k2.pub.x);

  r = await register(env, id, pub, OTHER);
  assert.equal(r.status, 403);
  assert.equal(env.INBOX.instance(id).storage.m.get('meta').pub.x, k2.pub.x, '다른 토큰은 키를 못 바꿔요');

  assert.equal((await register(env, rid(), pub, 'short')).status, 403, '토큰은 20자 이상');
  assert.equal((await call(env, 'PUT', `/inbox/${rid()}/key`, { body: JSON.stringify({ pub }) })).status, 403, '토큰 없음');

  const priv = await subtle.exportKey('jwk', (await subtle.generateKey(EC, true, ['deriveKey'])).privateKey);
  const rsa = await subtle.exportKey('jwk', (await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])).publicKey);
  const p384 = await subtle.exportKey('jwk', (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey'])).publicKey);
  const b64u = (u) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const offCurve = { ...pub, y: b64u(crypto.getRandomValues(new Uint8Array(32))) };
  const bad = [undefined, null, 'x', [], {}, rsa, p384, priv, offCurve, { ...pub, x: pub.x + 'A' }, { ...pub, crv: 'P-256K' }];
  for (const b of bad) {
    const nid = rid();
    r = await register(env, nid, b);
    assert.equal(r.status, 400, 'bad key: ' + JSON.stringify(b)?.slice(0, 60));
    assert.equal(env.INBOX.instance(nid).storage.m.size, 0);
  }
  r = await call(env, 'PUT', `/inbox/${rid()}/key`, { headers: ownerH(), body: '{nope' });
  assert.equal(r.status, 400);
});

test('POST /in/{id}: all body formats are stored encrypted and decrypt to the expected text', async () => {
  const env = makeEnv();
  const id = rid(40);
  const { pub, priv } = await newKeyPair();
  assert.equal((await register(env, id, pub)).status, 200);

  const cases = [
    ['text/plain; charset=utf-8', '  [Web발신]\n신한카드(1234)승인 홍*동 12,500원 일시불 11/16 12:34 스타벅스  ', '[Web발신]\n신한카드(1234)승인 홍*동 12,500원 일시불 11/16 12:34 스타벅스'],
    [null, 'KB국민카드 3,000원 승인', 'KB국민카드 3,000원 승인'],
    ['application/json', JSON.stringify({ text: '현대카드 승인 45,000원' }), '현대카드 승인 45,000원'],
    ['application/json', JSON.stringify({ message: '토스뱅크 입금 100,000원' }), '토스뱅크 입금 100,000원'],
    ['application/json', JSON.stringify({ body: '우리카드 8,900원' }), '우리카드 8,900원'],
    ['application/json', JSON.stringify({ content: '삼성카드 1,200원' }), '삼성카드 1,200원'],
    ['application/json', JSON.stringify({ title: '신한 SOL페이', text: '12,000원 결제 완료' }), '신한 SOL페이 12,000원 결제 완료'],
    ['application/json', JSON.stringify({ title: ' 카카오뱅크 ', message: ' 출금 5,000원 ' }), '카카오뱅크 출금 5,000원'],
    ['application/json', JSON.stringify({ Title: '하나카드', Text: '2,500원' }), '하나카드 2,500원'],
    ['application/x-www-form-urlencoded', 'text=' + encodeURIComponent('롯데카드 승인 33,000원'), '롯데카드 승인 33,000원'],
    ['application/x-www-form-urlencoded', new URLSearchParams({ title: 'NH농협', body: '출금 7,000원' }).toString(), 'NH농협 출금 7,000원'],
    // MacroDroid 템플릿에 원문을 그대로 넣어 JSON이 망가진 경우: 줄바꿈, 따옴표
    ['application/json', '{\n  "title": "신한카드",\n  "text": "승인 9,900원\n가맹점 \"편의점\""\n}', '신한카드 승인 9,900원\n가맹점 "편의점"'],
    ['application/json', '{"text":"[Web발신] "쿠팡" 결제 19,800원","title":"국민카드"}', '국민카드 [Web발신] "쿠팡" 결제 19,800원'],
    // 내용 유형을 text/plain으로 잘못 골라도 JSON이면 알아봐요
    ['text/plain', JSON.stringify({ text: 'BC카드 4,400원' }), 'BC카드 4,400원'],
    // 이름을 잘못 지어도 문자열 값을 모아요
    ['application/json', JSON.stringify({ msg: '씨티카드 6,600원' }), '씨티카드 6,600원'],
    ['application/json', JSON.stringify('그냥 문자열 1,000원'), '그냥 문자열 1,000원'],
    ['text/plain', '{중괄호로 시작하는 문자} 2,000원', '{중괄호로 시작하는 문자} 2,000원'],
    ['text/plain', '😀 이모지 3,300원', '😀 이모지 3,300원']
  ];
  for (const [ct, body, _] of cases) {
    const r = await post(env, id, body, ct);
    assert.equal(r.status, 200, `${ct}: ${body}`);
    assert.deepEqual(await jbody(r), { ok: true });
  }
  // multipart/form-data (단축어 '양식' 요청)
  const fd = new FormData();
  fd.append('title', '케이뱅크');
  fd.append('text', '입금 50,000원');
  assert.equal((await call(env, 'POST', `/in/${id}`, { body: fd })).status, 200);
  const expected = [...cases.map((c) => c[2]), '케이뱅크 입금 50,000원'];

  // 저장소에는 원문이 없어요
  const dump = JSON.stringify([...env.INBOX.instance(id).storage.m.values()]);
  for (const t of expected) for (const piece of t.split(/\s+/).filter((w) => w.length >= 4)) assert.ok(!dump.includes(piece), '원문 조각이 저장됨: ' + piece);

  const r = await list(env, id);
  assert.equal(r.status, 200);
  const { items } = await jbody(r);
  assert.equal(items.length, expected.length);
  const got = [];
  let prev = '';
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), ['at', 'ct', 'epk', 'id', 'iv']);
    assert.match(it.id, /^\d{13}-[0-9a-f]{16}$/);
    assert.ok(it.id > prev, '오래된 순'); prev = it.id;
    assert.ok(!Number.isNaN(Date.parse(it.at)) && it.at === new Date(Date.parse(it.at)).toISOString());
    for (const f of ['epk', 'iv', 'ct']) assert.match(it[f], STD_B64);
    const epk = unb64(it.epk);
    assert.equal(epk.length, 65); assert.equal(epk[0], 4, '비압축 raw 공개키');
    assert.equal(unb64(it.iv).length, 12);
    got.push(await decrypt(it, priv));
  }
  // 같은 ms에 들어온 것끼리는 순서가 섞일 수 있어서 내용만 비교해요.
  assert.deepEqual([...got].sort(), [...expected].sort());
  assert.equal(new Set(items.map((i) => i.epk)).size, items.length, '메시지마다 임시 키가 달라요');

  // 아무 키나 오면 안 풀려요
  const stranger = await newKeyPair();
  await assert.rejects(decrypt(items[0], stranger.priv));
});

test('POST /in/{id}: 404 unregistered, 400 empty, 413 too long/too big, 405 wrong method, 429 when full', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub, priv } = await newKeyPair();
  assert.equal((await post(env, rid(), '신한카드 1,000원', 'text/plain')).status, 404, '등록 안 된 id');
  assert.equal(env.INBOX.instance(id).storage.m.size, 0);
  assert.equal((await post(env, 'short', 'x', 'text/plain')).status, 404, 'id 형식 틀림(22자 미만)');
  assert.equal((await post(env, 'a'.repeat(65), 'x', 'text/plain')).status, 404, 'id 형식 틀림(64자 초과)');
  assert.equal((await post(env, 'a'.repeat(21) + '!', 'x', 'text/plain')).status, 404);
  assert.equal((await register(env, id, pub)).status, 200);

  for (const [body, ct] of [['', 'text/plain'], ['   \n\t ', 'text/plain'], [JSON.stringify({ text: '  ' }), 'application/json'], ['text=', 'application/x-www-form-urlencoded'], [null, null]]) {
    const r = await post(env, id, body, ct);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(await jbody(r), { error: 'empty' });
  }
  assert.equal((await post(env, id, '가'.repeat(4001), 'text/plain')).status, 413);
  assert.equal((await post(env, id, JSON.stringify({ title: '가'.repeat(2000), text: '나'.repeat(2000) }), 'application/json')).status, 413, 'title + 공백 + text = 4001자');
  let r = await post(env, id, 'x'.repeat(70000), 'text/plain');
  assert.equal(r.status, 413, '본문 64KB 초과');
  assert.deepEqual(await jbody(r), { error: 'too_large' }, '다 읽기 전에 끊어요');
  // Content-Length 없이 조금씩 흘려보내도 64KB에서 끊어요
  let sent = 0;
  const stream = new ReadableStream({ pull(c) { if (sent > 1e6) return c.close(); sent += 8192; c.enqueue(new Uint8Array(8192).fill(0x61)); } });
  r = await call(env, 'POST', `/in/${id}`, { headers: { 'Content-Type': 'text/plain' }, body: stream, duplex: 'half' });
  assert.equal(r.status, 413);
  assert.ok(sent < 200000, '스트림을 끝까지 읽지 않아요');
  r = await worker.fetch(new Request(BASE + `/in/${id}`, { method: 'POST', headers: { 'Content-Length': '999999', 'Content-Type': 'text/plain' }, body: 'x' }), env);
  assert.equal(r.status, 413, 'Content-Length가 크면 바로 413');
  assert.equal((await post(env, id, 'text=' + encodeURIComponent('가'.repeat(4000)), 'application/x-www-form-urlencoded')).status, 200, 'form 인코딩 한글 4000자는 받아요');
  assert.equal((await post(env, id, '  ' + '가'.repeat(4000) + '  ', 'text/plain')).status, 200, '공백 정리 후 4000자');
  assert.equal((await call(env, 'GET', `/in/${id}`)).status, 405);
  assert.equal((await call(env, 'PUT', `/in/${id}`, { body: 'x' })).status, 405);
  assert.equal((await post(env, id + '/', '끝에 / 붙은 주소 1,000원', 'text/plain')).status, 200);

  // 300개까지 쌓이고, 그다음은 429
  const items0 = (await jbody(await list(env, id))).items.length;
  for (let i = items0; i < 300; i++) assert.equal((await post(env, id, `알림 ${i}`, 'text/plain')).status, 200);
  r = await post(env, id, '하나 더', 'text/plain');
  assert.equal(r.status, 429);
  const { items } = await jbody(await list(env, id));
  assert.equal(items.length, 300);
  assert.equal(await decrypt(items[299], priv), '알림 299');
  // 하나 지우면 다시 받아요
  assert.deepEqual(await jbody(await ack(env, id, [items[0].id])), { ok: true, deleted: 1 });
  assert.equal((await post(env, id, '하나 더', 'text/plain')).status, 200);
});

test('simultaneous notifications are never lost', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub, priv } = await newKeyPair();
  await register(env, id, pub);
  const texts = Array.from({ length: 40 }, (_, i) => `동시 알림 ${i} ${i * 1000}원`);
  const rs = await Promise.all(texts.map((t, i) => post(env, id, i % 2 ? JSON.stringify({ text: t }) : t, i % 2 ? 'application/json' : 'text/plain')));
  assert.ok(rs.every((r) => r.status === 200));
  const { items } = await jbody(await list(env, id));
  assert.equal(items.length, texts.length);
  assert.equal(new Set(items.map((i) => i.id)).size, texts.length);
  const got = await Promise.all(items.map((it) => decrypt(it, priv)));
  assert.deepEqual(got.sort(), [...texts].sort());
});

test('GET /inbox/{id} and ack: 403 wrong/missing token, 404 unknown id, ack deletes only listed ids', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub } = await newKeyPair();
  assert.equal((await list(env, rid())).status, 404);
  await register(env, id, pub);
  assert.deepEqual(await jbody(await list(env, id)), { items: [] });
  for (const t of ['a', 'b', 'c', 'd']) await post(env, id, `알림 ${t}`, 'text/plain');

  assert.equal((await list(env, id, OTHER)).status, 403);
  assert.equal((await call(env, 'GET', `/inbox/${id}`)).status, 403, '토큰 없음');
  assert.equal((await ack(env, id, [], OTHER)).status, 403);
  assert.equal((await ack(env, rid(), [])).status, 404);

  const { items } = await jbody(await list(env, id));
  let r = await ack(env, id, [items[0].id, items[2].id, items[0].id, 'nope', 42, '../meta', 'meta']);
  assert.equal(r.status, 200);
  assert.deepEqual(await jbody(r), { ok: true, deleted: 2 });
  assert.deepEqual((await jbody(await list(env, id))).items.map((i) => i.id), [items[1].id, items[3].id]);
  assert.ok(env.INBOX.instance(id).storage.m.has('meta'), 'ack로 meta는 못 지워요');
  assert.deepEqual(await jbody(await ack(env, id, [items[0].id])), { ok: true, deleted: 0 });

  for (const body of ['{bad', JSON.stringify({}), JSON.stringify({ ids: 'x' }), JSON.stringify({ ids: Array(1001).fill('x') })]) {
    r = await call(env, 'POST', `/inbox/${id}/ack`, { headers: ownerH(), body });
    assert.equal(r.status, 400, body.slice(0, 30));
  }
  // 200개를 한 번에 ack (storage.delete 128개 제한을 나눠서 처리)
  const id2 = rid();
  await register(env, id2, pub);
  for (let i = 0; i < 200; i++) await post(env, id2, `알림 ${i}`, 'text/plain');
  const all = (await jbody(await list(env, id2))).items.map((i) => i.id);
  assert.deepEqual(await jbody(await ack(env, id2, all)), { ok: true, deleted: 200 });
  assert.deepEqual(await jbody(await list(env, id2)), { items: [] });

  assert.equal((await call(env, 'PUT', `/inbox/${id}`, { headers: ownerH() })).status, 405);
  assert.equal((await call(env, 'GET', `/inbox/${id}/ack`, { headers: ownerH() })).status, 405);
  assert.equal((await call(env, 'POST', `/inbox/${id}/key`, { headers: ownerH() })).status, 405);
  assert.equal((await call(env, 'GET', `/inbox/${id}/other`, { headers: ownerH() })).status, 404);
  assert.equal((await call(env, 'GET', '/inbox', { headers: ownerH() })).status, 404);
});

test('DELETE /inbox/{id}: 403 other token, wipes everything, idempotent', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub } = await newKeyPair();
  await register(env, id, pub);
  await post(env, id, '알림', 'text/plain');
  const st = env.INBOX.instance(id).storage;
  assert.ok(st.alarm != null);
  assert.equal((await call(env, 'DELETE', `/inbox/${id}`, { headers: ownerH(OTHER) })).status, 403);
  assert.equal((await call(env, 'DELETE', `/inbox/${id}`)).status, 403, '토큰 없음');
  assert.equal(st.m.size, 2);
  let r = await call(env, 'DELETE', `/inbox/${id}`, { headers: ownerH() });
  assert.equal(r.status, 200);
  assert.deepEqual(await jbody(r), { ok: true });
  assert.equal(st.m.size, 0);
  assert.equal(st.alarm, null);
  assert.equal((await list(env, id)).status, 404);
  assert.equal((await post(env, id, '알림', 'text/plain')).status, 404);
  r = await call(env, 'DELETE', `/inbox/${id}`, { headers: ownerH() });
  assert.equal(r.status, 200, '이미 지운 받은편지함도 ok');
  // 지운 뒤에는 누구든 새로 만들 수 있어요(새 토큰)
  assert.equal((await register(env, id, pub, OTHER)).status, 200);
});

test('alarm deletes messages older than 7 days and re-arms for the next oldest', async () => {
  const env = makeEnv();
  const id = rid();
  const { pub, priv } = await newKeyPair();
  await register(env, id, pub);
  const st = env.INBOX.instance(id).storage;
  const realNow = Date.now;
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  try {
    Date.now = () => t0;
    await post(env, id, '첫째 날', 'text/plain');
    assert.equal(st.alarm, t0 + 7 * DAY);
    Date.now = () => t0 + 2 * DAY;
    await post(env, id, '셋째 날', 'text/plain');
    assert.equal(st.alarm, t0 + 7 * DAY, '알람은 가장 오래된 알림 기준');
    Date.now = () => t0 + 6 * DAY;
    await post(env, id, '일곱째 날', 'text/plain');

    // 일찍 울려도 아무것도 안 지워요
    Date.now = () => t0 + 7 * DAY - 1;
    await env.INBOX.fireAlarm(id);
    assert.equal((await jbody(await list(env, id))).items.length, 3);
    assert.equal(st.alarm, t0 + 7 * DAY);

    Date.now = () => t0 + 7 * DAY;
    await env.INBOX.fireAlarm(id);
    let { items } = await jbody(await list(env, id));
    assert.deepEqual(await Promise.all(items.map((i) => decrypt(i, priv))), ['셋째 날', '일곱째 날']);
    assert.equal(items[0].at, new Date(t0 + 2 * DAY).toISOString());
    assert.equal(st.alarm, t0 + 9 * DAY);

    Date.now = () => t0 + 20 * DAY;
    await env.INBOX.fireAlarm(id);
    ({ items } = await jbody(await list(env, id)));
    assert.equal(items.length, 0);
    assert.equal(st.alarm, null, '다 지우면 알람도 없어요');
    assert.ok(st.m.has('meta'), '받은편지함 자체는 남아요');

    // 알람이 없을 때 새 알림이 오면 다시 걸어요
    await post(env, id, '새 알림', 'text/plain');
    assert.equal(st.alarm, t0 + 27 * DAY);
    // 빈 받은편지함에서 울려도 괜찮아요
    await call(env, 'DELETE', `/inbox/${id}`, { headers: ownerH() });
    await env.INBOX.fireAlarm(id);
    assert.equal(st.alarm, null);
  } finally {
    Date.now = realNow;
  }

  // 150개가 한꺼번에 만료돼도 (128개씩 나눠) 다 지워요
  const id2 = rid();
  await register(env, id2, pub);
  try {
    Date.now = () => t0;
    for (let i = 0; i < 150; i++) await post(env, id2, `만료 ${i}`, 'text/plain');
    Date.now = () => t0 + 8 * DAY;
    await env.INBOX.fireAlarm(id2);
    assert.deepEqual(await jbody(await list(env, id2)), { items: [] });
  } finally {
    Date.now = realNow;
  }
});

test('inbox routes answer 503 when the INBOX binding is missing (old wrangler.toml)', async () => {
  const env = { MOA_SYNC: new MemKV() };
  assert.equal((await post(env, rid(), 'x', 'text/plain')).status, 503);
  assert.equal((await list(env, rid())).status, 503);
});

test('/v1 sync still works as before', async () => {
  const env = makeEnv();
  const id = rid(16);
  const W = { 'X-Write-Token': 'write-token-' + rid(20), 'Content-Type': 'application/json' };
  let r = await call(env, 'OPTIONS', `/v1/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Methods'), 'GET,PUT,DELETE,OPTIONS');
  assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type,X-Write-Token');
  assert.equal((await call(env, 'GET', `/v1/${id}`)).status, 404);
  r = await call(env, 'PUT', `/v1/${id}`, { headers: W, body: JSON.stringify({ base: 0, iv: 'aXY=', data: 'ZGF0YQ==' }) });
  assert.equal(r.status, 200);
  const put = await jbody(r);
  assert.equal(put.v, 1);
  r = await call(env, 'GET', `/v1/${id}`);
  assert.deepEqual(await jbody(r), { v: 1, iv: 'aXY=', data: 'ZGF0YQ==', at: put.at });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await call(env, 'PUT', `/v1/${id}`, { headers: W, body: JSON.stringify({ base: 0, iv: 'x', data: 'y' }) })).status, 409);
  assert.equal((await call(env, 'PUT', `/v1/${id}`, { headers: { ...W, 'X-Write-Token': 'another-token-' + rid(20) }, body: JSON.stringify({ base: 1, iv: 'x', data: 'y' }) })).status, 403);
  assert.equal((await call(env, 'DELETE', `/v1/${id}`, { headers: W })).status, 200);
  assert.equal((await call(env, 'GET', `/v1/${id}`)).status, 404);
  assert.equal((await call(env, 'GET', '/nothing')).status, 404);
  assert.equal((await call(env, 'GET', '/v1/short')).status, 404);
  // /in, /inbox 와 비슷하지만 다른 경로는 예전처럼
  r = await call(env, 'OPTIONS', '/index');
  assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type,X-Write-Token');
});

test('/kis relay still works as before', async () => {
  const env = makeEnv();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([String(url), init]); return new Response('{"access_token":"t"}', { status: 200, headers: { tr_cont: 'M' } }); };
  try {
    let r = await call(env, 'OPTIONS', '/kis/token');
    assert.equal(r.headers.get('Access-Control-Allow-Headers'), 'Content-Type,authorization,appkey,appsecret,tr_id,tr_cont,custtype');
    r = await call(env, 'POST', '/kis/token', { body: JSON.stringify({ appkey: 'k', appsecret: 's' }) });
    assert.equal(r.status, 200);
    assert.equal(calls[0][0], 'https://openapi.koreainvestment.com:9443/oauth2/tokenP');
    assert.deepEqual(JSON.parse(calls[0][1].body), { grant_type: 'client_credentials', appkey: 'k', appsecret: 's' });
    r = await call(env, 'GET', '/kis/uapi/domestic-stock/v1/trading/inquire-balance?CANO=1', { headers: { tr_id: 'TTTC8434R', authorization: 'Bearer t' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('tr_cont'), 'M');
    assert.equal(calls[1][0], 'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/trading/inquire-balance?CANO=1');
    r = await call(env, 'POST', '/kis/uapi/domestic-stock/v1/trading/order-cash', { headers: { tr_id: 'TTTC0802U' } });
    assert.equal(r.status, 403);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
