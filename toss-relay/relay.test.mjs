// 토스 중계 프로그램 테스트: node --test toss-relay/relay.test.mjs
// 가짜 토스 서버를 띄우고, 허용 목록·CORS/PNA·헤더 전달·오류 처리·기록(log)에 비밀이 없는지 확인해요.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startRelay, ROUTES, ORIGINS } from './relay.mjs';

const PAGES = 'https://converseddululu.github.io';
const SECRET = 's_super_secret_value';
const TOKEN = 'eyJ.secret.token';

let upstream, relay, port, logs = [];
const hits = [];
let reply = null; // 테스트별로 가짜 토스 응답을 바꿔요

before(async () => {
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      const r = reply ? reply(req) : { status: 200, body: { result: { ok: true, path: req.url } } };
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '4', 'Set-Cookie': 'should-not-pass=1', ...(r.headers || {}) });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  relay = await startRelay({ port: 0, upstream: `http://127.0.0.1:${upstream.address().port}`, family: 0, ip: '1.2.3.4', log: l => logs.push(l) });
  port = relay.address().port;
});

after(async () => {
  relay.closeAllConnections(); upstream.closeAllConnections();
  await new Promise(r => relay.close(r));
  await new Promise(r => upstream.close(r));
});

function send({ method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null; try { json = JSON.parse(text); } catch { /* 비어 있음 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const reset = () => { hits.length = 0; reply = null; logs = []; };

test('127.0.0.1에서만 들어요', () => {
  assert.equal(relay.address().address, '127.0.0.1');
});

test('/health: 켜져 있는지와 공인 IP', async () => {
  reset();
  const r = await send({ path: '/health', headers: { Origin: PAGES } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, service: 'moa-toss-relay', version: 1, ip: '1.2.3.4' });
  assert.equal(r.headers['access-control-allow-origin'], PAGES);
  assert.equal(hits.length, 0);
});

test('사전 요청(preflight): CORS와 Chrome 사설 네트워크 접근(PNA) 허락', async () => {
  reset();
  for (const origin of ORIGINS) {
    const r = await send({ method: 'OPTIONS', path: '/api/v1/holdings', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-tossinvest-account', 'Access-Control-Request-Private-Network': 'true'
    } });
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], origin);
    assert.equal(r.headers['access-control-allow-private-network'], 'true');
    assert.match(r.headers['access-control-allow-headers'], /Authorization/);
    assert.match(r.headers['access-control-allow-headers'], /X-Tossinvest-Account/);
    assert.match(r.headers['access-control-allow-headers'], /Content-Type/);
    assert.match(r.headers['access-control-allow-methods'], /GET/);
    assert.match(r.headers.vary, /Origin/);
  }
  // PNA를 묻지 않으면 PNA 헤더도 없어요
  const plain = await send({ method: 'OPTIONS', path: '/oauth2/token', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(plain.status, 204);
  assert.equal(plain.headers['access-control-allow-private-network'], undefined);
  // /health 사전 요청도 받아요
  const h = await send({ method: 'OPTIONS', path: '/health', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(h.status, 204);
  assert.equal(h.headers['access-control-allow-private-network'], 'true');
  assert.equal(hits.length, 0);
});

test('다른 사이트(Origin)·다른 Host는 막아요', async () => {
  reset();
  const pre = await send({ method: 'OPTIONS', path: '/api/v1/holdings', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers['access-control-allow-origin'], undefined);
  assert.equal(pre.headers['access-control-allow-private-network'], undefined);

  const get = await send({ path: '/api/v1/accounts', headers: { Origin: 'https://converseddululu.github.io.evil.example', Authorization: 'Bearer x' } });
  assert.equal(get.status, 403);
  assert.equal(get.json.error.code, 'relay-forbidden-origin');

  const rebind = await send({ path: '/api/v1/accounts', headers: { Host: `evil.example:${port}`, Authorization: 'Bearer x' } });
  assert.equal(rebind.status, 403);
  assert.equal(rebind.json.error.code, 'relay-forbidden-host');

  const lh = await send({ path: '/health', headers: { Host: `localhost:${port}` } });
  assert.equal(lh.status, 200);
  assert.equal(hits.length, 0);
});

test('허용 목록 밖(주문·취소 등)은 403이고 토스로 넘기지 않아요', async () => {
  reset();
  const bad = [
    ['POST', '/api/v1/orders'], ['GET', '/api/v1/orders'], ['POST', '/api/v1/orders/1/cancel'], ['DELETE', '/api/v1/conditional-orders/1'],
    ['GET', '/api/v1/buying-power'], ['GET', '/oauth2/token'], ['POST', '/api/v1/holdings'], ['PUT', '/api/v1/holdings'],
    ['GET', '/api/v1/holdings/'], ['GET', '/api/v1/holdings/../orders'], ['GET', '/API/V1/HOLDINGS'], ['GET', '/api/v1/holdings%2F..%2Forders'],
    ['GET', '/'], ['GET', '/api/v1/stocks?symbols=AAPL']
  ];
  for (const [method, path] of bad) {
    const r = await send({ method, path, headers: { Origin: PAGES, Authorization: 'Bearer x' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.json.error.code, 'relay-forbidden-path', `${method} ${path}`);
    assert.equal(r.headers['access-control-allow-origin'], PAGES);
  }
  const pre = await send({ method: 'OPTIONS', path: '/api/v1/orders', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 403);
  assert.equal(hits.length, 0);
  assert.equal(ROUTES.size, 6);
});

test('GET 조회: 경로·쿼리 그대로, 필요한 헤더만 넘기고 응답은 그대로 돌려줘요', async () => {
  reset();
  reply = () => ({ status: 200, body: { result: { items: [] } }, headers: { 'X-Request-Id': 'req-1' } });
  const q = '/api/v1/transactions?transactionTypes=BUY,SELL&limit=100&cursor=abc_-1&from=2025-01-01';
  const r = await send({ path: q, headers: { Origin: PAGES, Authorization: `Bearer ${TOKEN}`, 'X-Tossinvest-Account': '7', Cookie: 'sid=1', 'X-Other': 'no', 'Accept-Encoding': 'gzip' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { result: { items: [] } });
  assert.equal(r.headers['access-control-allow-origin'], PAGES);
  assert.match(r.headers['access-control-expose-headers'], /Retry-After/);
  assert.equal(r.headers['x-ratelimit-remaining'], '4');
  assert.equal(r.headers['x-request-id'], 'req-1');
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal(r.headers['cache-control'], 'no-store');

  assert.equal(hits.length, 1);
  const h = hits[0];
  assert.equal(h.method, 'GET');
  assert.equal(h.url, q);
  assert.equal(h.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(h.headers['x-tossinvest-account'], '7');
  for (const k of ['cookie', 'origin', 'x-other', 'accept-encoding', 'referer']) assert.equal(h.headers[k], undefined, k);

  for (const p of ['/api/v1/accounts', '/api/v1/holdings', '/api/v1/prices?symbols=005930,AAPL,BRK.B', '/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW']) {
    const x = await send({ path: p, headers: { Origin: 'null', Authorization: 'Bearer t' } });
    assert.equal(x.status, 200, p);
    assert.equal(x.headers['access-control-allow-origin'], 'null');
  }
  assert.deepEqual(hits.slice(1).map(h => h.url), ['/api/v1/accounts', '/api/v1/holdings', '/api/v1/prices?symbols=005930,AAPL,BRK.B', '/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW']);
});

test('POST /oauth2/token: 본문과 Content-Type을 넘기고, 기록에 비밀이 없어요', async () => {
  reset();
  reply = () => ({ status: 200, body: { access_token: TOKEN, token_type: 'Bearer', expires_in: 86400 } });
  const body = `grant_type=client_credentials&client_id=tsck_live_abc&client_secret=${SECRET}`;
  const r = await send({ method: 'POST', path: '/oauth2/token', headers: { Origin: PAGES, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal(r.status, 200);
  assert.equal(r.json.access_token, TOKEN);
  assert.equal(hits[0].body, body);
  assert.equal(hits[0].headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(hits[0].headers['content-length'], String(Buffer.byteLength(body)));

  await send({ path: '/api/v1/transactions?cursor=secretcursor', headers: { Origin: PAGES, Authorization: `Bearer ${TOKEN}` } });
  const all = logs.join('\n');
  assert.ok(logs.some(l => l.includes('POST /oauth2/token → 200')), all);
  for (const s of [SECRET, TOKEN, 'tsck_live_abc', 'secretcursor']) assert.ok(!all.includes(s), s);
});

test('토스 오류(403 IP·429)는 상태·Retry-After 그대로 넘기고 IP 안내를 기록해요', async () => {
  reset();
  reply = () => ({ status: 403, body: { error: 'access_denied', error_description: 'IP address not allowed' } });
  const r = await send({ method: 'POST', path: '/oauth2/token', headers: { Origin: PAGES, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'access_denied');
  assert.ok(logs.some(l => l.includes('허용 IP') && l.includes('1.2.3.4')), logs.join('\n'));

  reply = () => ({ status: 429, body: { error: { code: 'rate-limit-exceeded' } }, headers: { 'Retry-After': '3' } });
  const r2 = await send({ path: '/api/v1/holdings', headers: { Origin: PAGES, Authorization: 'Bearer t', 'X-Tossinvest-Account': '1' } });
  assert.equal(r2.status, 429);
  assert.equal(r2.headers['retry-after'], '3');
  assert.equal(r2.headers['access-control-allow-origin'], PAGES);
});

test('이상한 쿼리·너무 큰 본문은 거절해요', async () => {
  reset();
  const q = await send({ path: '/api/v1/prices?symbols=<script>', headers: { Origin: PAGES } });
  assert.equal(q.status, 400);
  const big = await send({ method: 'POST', path: '/oauth2/token', headers: { Origin: PAGES, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(20000) });
  assert.equal(big.status, 413);
  assert.equal(hits.length, 0);
});

test('토스에 닿지 못하면 502 relay-upstream-unreachable', async () => {
  const dead = await startRelay({ port: 0, upstream: 'http://127.0.0.1:1', family: 0, log: () => {} });
  try {
    const p = dead.address().port;
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: p, path: '/api/v1/accounts', headers: { Origin: PAGES, Authorization: 'Bearer t' }, agent: false }, res => {
        let s = ''; res.on('data', c => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(s), acao: res.headers['access-control-allow-origin'] }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, 'relay-upstream-unreachable');
    assert.equal(r.acao, PAGES);
  } finally {
    dead.closeAllConnections();
    await new Promise(r => dead.close(r));
  }
});
