// 모아 가계부 · 토스증권 중계 프로그램 (조회 전용)
//
// 토스증권 Open API는 '허용 IP'로 등록한 곳에서만 받아 주고, 브라우저에서 바로 부를 수 없어요(CORS 헤더 없음).
// 이 프로그램을 집 PC에서 켜 두면, 같은 PC의 브라우저에서 연 모아 가계부가 http://127.0.0.1:8790 으로 토스를 불러요.
//
// - 이 PC 안(127.0.0.1)에서만 받아요. 다른 기기나 인터넷에서는 접속할 수 없어요.
// - 조회 6가지만 토스로 넘기고, 주문·취소 같은 나머지는 모두 막아요 (403).
// - 키·토큰을 저장하지 않고, 화면 기록에도 남기지 않아요 (어떤 주소를 불렀는지와 결과 번호만 보여 줘요).
// - 외부 라이브러리 없이 Node.js(18 이상)만 있으면 돼요.
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPSTREAM = 'https://openapi.tossinvest.com';
export const PORT = 8790;
// 토스로 넘기는 요청은 이것뿐이에요 (메서드 + 경로가 정확히 같아야 해요).
export const ROUTES = new Set([
  'POST /oauth2/token',
  'GET /api/v1/accounts',
  'GET /api/v1/holdings',
  'GET /api/v1/transactions',
  'GET /api/v1/prices',
  'GET /api/v1/exchange-rate'
]);
// 모아 가계부 주소(GitHub Pages)와 내려받은 HTML 파일(브라우저가 Origin을 'null'로 보내요)만 받아요.
export const ORIGINS = ['https://converseddululu.github.io', 'null'];

const PASS_REQ = ['authorization', 'x-tossinvest-account', 'content-type'];
const PASS_RES = ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'www-authenticate', 'x-request-id'];
const EXPOSE = 'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id';
const MAX_URL = 4096;
const MAX_BODY = 16 * 1024;
const MAX_RES = 8 * 1024 * 1024;
const TIMEOUT = 20000;

const hhmmss = () => new Date().toTimeString().slice(0, 8);
const json = (res, status, body, headers = {}) => {
  const b = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
};
const fail = (res, status, code, message, headers) => json(res, status, { error: { code, message } }, headers);

/**
 * 중계 서버를 만들어요 (아직 듣지는 않아요). 테스트에서는 upstream을 가짜 서버로 바꿔요.
 * @param {{upstream?: string, origins?: string[], log?: (line: string) => void, family?: 0|4|6, ip?: string|null}} [opts]
 */
export function createRelay(opts = {}) {
  const upstream = new URL(opts.upstream || UPSTREAM);
  const origins = new Set(opts.origins || ORIGINS);
  const log = opts.log || (() => {});
  // 토스에는 IPv4로만 연결해요. 허용 IP에 등록하는 주소(IPv4)와 실제로 나가는 주소를 맞추려고요.
  const family = opts.family ?? 4;
  const lib = upstream.protocol === 'https:' ? https : http;
  const agent = new lib.Agent({ keepAlive: true, maxSockets: 4 });
  const state = { ip: opts.ip || null };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) fail(res, 500, 'relay-error', '중계 프로그램 오류'); else res.destroy(); });
  });
  server.relayState = state;
  server.on('close', () => agent.destroy());

  function allowed(method, p) {
    return ROUTES.has(`${method} ${p}`) || (method === 'GET' && p === '/health');
  }

  async function handle(req, res) {
    const port = server.address() && server.address().port;
    const host = String(req.headers.host || '').toLowerCase();
    // 다른 사이트가 DNS를 바꿔치기해 이 프로그램을 부르는 것(DNS rebinding)을 막아요.
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return fail(res, 403, 'relay-forbidden-host', 'Host not allowed');

    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) return fail(res, 403, 'relay-forbidden-origin', 'Origin not allowed', { Vary: 'Origin' });
    const cors = origin === undefined ? { Vary: 'Origin' } : { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': EXPOSE, Vary: 'Origin' };

    const url = String(req.url || '');
    if (url.length > MAX_URL) return fail(res, 414, 'relay-url-too-long', 'URL too long', cors);
    const qi = url.indexOf('?');
    const p = qi < 0 ? url : url.slice(0, qi), query = qi < 0 ? '' : url.slice(qi + 1);

    // 사전 요청(preflight). Chrome의 사설 네트워크 접근(PNA) 확인도 여기서 허락해요.
    if (req.method === 'OPTIONS') {
      const m = String(req.headers['access-control-request-method'] || '').toUpperCase();
      if (!allowed(m, p)) return fail(res, 403, 'relay-forbidden-path', 'Not allowed', cors);
      const h = {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Tossinvest-Account',
        'Access-Control-Max-Age': '600',
        'Content-Length': '0'
      };
      if (String(req.headers['access-control-request-private-network'] || '').toLowerCase() === 'true') h['Access-Control-Allow-Private-Network'] = 'true';
      res.writeHead(204, h);
      return res.end();
    }

    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, service: 'moa-toss-relay', version: 1, ip: state.ip }, cors);

    if (!ROUTES.has(`${req.method} ${p}`)) {
      log(`[${hhmmss()}] 막음: ${req.method} ${p.slice(0, 80)}`);
      return fail(res, 403, 'relay-forbidden-path', '토스 중계 프로그램은 조회만 넘겨요', cors);
    }
    if (!/^[\w.~\-=&%,:+]*$/.test(query)) return fail(res, 400, 'relay-bad-query', 'Bad query', cors);

    let body = null;
    if (req.method === 'POST') {
      body = await new Promise(resolve => {
        const chunks = [];
        let size = 0;
        req.on('data', c => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
        req.on('end', () => resolve(size > MAX_BODY ? 'too-large' : Buffer.concat(chunks)));
        req.on('error', () => resolve('too-large'));
      });
      if (body === 'too-large') return fail(res, 413, 'relay-body-too-large', 'Body too large', cors);
    } else {
      req.resume();
    }

    const headers = { accept: 'application/json', 'user-agent': 'moa-toss-relay/1' };
    for (const k of PASS_REQ) if (req.headers[k] !== undefined) headers[k] = req.headers[k];
    if (body) headers['content-length'] = String(body.length);

    let up;
    try {
      up = await forward(req.method, upstream.pathname.replace(/\/+$/, '') + url, headers, body);
    } catch (e) {
      const timeout = e && e.code === 'RELAY_TIMEOUT';
      log(`[${hhmmss()}] ${req.method} ${p} → ${timeout ? '토스 응답 없음 (시간 초과)' : '토스에 연결 못 함 (인터넷 확인)'}`);
      return timeout
        ? fail(res, 504, 'relay-upstream-timeout', '토스 서버가 늦게 답해요', cors)
        : fail(res, 502, 'relay-upstream-unreachable', '토스 서버에 연결하지 못했어요', cors);
    }

    log(`[${hhmmss()}] ${req.method} ${p} → ${up.status}${hint(up)}`);
    const out = { ...cors, 'Cache-Control': 'no-store', 'Content-Length': up.body.length };
    for (const k of PASS_RES) if (up.headers[k] !== undefined) out[k] = up.headers[k];
    res.writeHead(up.status, out);
    res.end(up.body);
  }

  // 사용자에게 도움이 되는 한 줄만 덧붙여요. 응답 내용(키·토큰·잔고)은 기록하지 않아요.
  function hint(up) {
    if (up.status === 403 && /ip-not-allowed|IP address not allowed/.test(up.body.toString('utf8', 0, 2000)))
      return `  ← 이 PC의 IP${state.ip ? `(${state.ip})` : ''}가 토스 '허용 IP 관리'에 없어요`;
    if (up.status === 401 && /invalid_client/.test(up.body.toString('utf8', 0, 2000))) return '  ← Client ID/Secret이 맞지 않아요';
    return '';
  }

  function forward(method, pathq, headers, body) {
    return new Promise((resolve, reject) => {
      const r = lib.request({
        protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined,
        method, path: pathq, headers, agent, family: family || undefined, timeout: TIMEOUT
      }, res => {
        const chunks = [];
        let size = 0;
        res.on('data', c => {
          size += c.length;
          if (size > MAX_RES) { r.destroy(new Error('response too large')); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode || 502, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'RELAY_TIMEOUT' })));
      r.on('error', reject);
      r.end(body || undefined);
    });
  }

  return server;
}

/** 127.0.0.1에서만 듣기 시작해요. */
export function startRelay(opts = {}) {
  const server = createRelay(opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? PORT, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}

/** 이 PC의 공인 IPv4 주소 (토스 '허용 IP 관리'에 넣을 값). 못 찾으면 null. */
export function lookupPublicIp(timeout = 5000) {
  return new Promise(resolve => {
    const r = https.get('https://api.ipify.org', { family: 4, timeout, headers: { 'user-agent': 'moa-toss-relay/1' } }, res => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (s.length < 100) s += c; });
      res.on('end', () => { s = s.trim(); resolve(/^\d{1,3}(\.\d{1,3}){3}$/.test(s) ? s : null); });
      res.on('error', () => resolve(null));
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => resolve(null));
  });
}

async function main() {
  const port = Number(process.env.TOSS_RELAY_PORT) || PORT;
  const extra = String(process.env.TOSS_RELAY_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  let server;
  try {
    server = await startRelay({ port, origins: [...ORIGINS, ...extra], log: line => console.log(line) });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.log(`\n이미 토스 중계 프로그램이 켜져 있어요 (포트 ${port}). 검은 창이 두 개라면 하나만 남겨 주세요.\n`);
    else console.log(`\n중계 프로그램을 켜지 못했어요: ${e && e.message}\n`);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log('  모아 가계부 · 토스증권 중계 프로그램이 켜졌어요');
  console.log(`  주소: http://127.0.0.1:${port}  (이 PC 안에서만 받아요)`);
  console.log('  이 창을 켜 둔 채로, 이 PC의 브라우저에서 모아 가계부를 열고 토스증권을 불러오세요.');
  console.log('  끄려면 이 창을 닫으면 돼요.');
  console.log('');
  if (!process.env.TOSS_RELAY_NO_IP_LOOKUP) {
    const ip = await lookupPublicIp();
    server.relayState.ip = ip;
    if (ip) console.log(`  토스 '허용 IP 관리'에 등록할 이 PC의 IP: ${ip}`);
    else console.log("  이 PC의 IP를 확인하지 못했어요. 브라우저에서 https://api.ipify.org 를 열면 나오는 숫자를 토스 '허용 IP 관리'에 등록하세요.");
    console.log('');
  }
}

const self = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (process.platform === 'win32' ? self.toLowerCase() === entry.toLowerCase() : self === entry) main();
