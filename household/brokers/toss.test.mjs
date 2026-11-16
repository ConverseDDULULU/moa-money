// 토스증권 연결 모듈 테스트: node --test household/brokers/toss.test.mjs
// 진짜 토스 대신 가짜 fetch(중계 + 토스 흉내)를 넣고, Holding/Realized 모양·쪽 넘기기·토큰 재사용·오류 문구를 확인해요.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./toss.js', import.meta.url), 'utf8');
const RELAY = 'http://127.0.0.1:8790';

// toss.js를 브라우저처럼 불러와요. setTimeout은 기다리지 않고 바로 실행(5초 이상 타이머는 실행 안 함)해서 시간을 기록해요.
function load(fetchImpl) {
  let def = null;
  const delays = [];
  const win = { MoaBrokers: { register: d => { def = d; } } };
  const fakeTimeout = (fn, ms) => { delays.push(ms); if (ms < 5000) Promise.resolve().then(fn); return 0; };
  new Function('window', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', SRC)(win, fetchImpl, fakeTimeout, () => {}, AbortController);
  return { def, delays };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// 가짜 중계 + 토스. hook(c)가 Response를 돌려주면 그걸 먼저 써요.
function mockToss(o = {}) {
  const S = { calls: [], valid: null, n: 0, ip: o.ip === undefined ? '1.2.3.4' : o.ip, base: o.base || RELAY, hook: o.hook || null, routes: o.routes || {} };
  S.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    const c = { method, path: u.pathname, search: u.search, query: Object.fromEntries(u.searchParams), headers, body: init.body };
    S.calls.push(c);
    if (o.down || u.origin !== S.base) throw new TypeError('Failed to fetch');
    if (S.hook) { const r = await S.hook(c, S); if (r) return r; }
    if (method === 'GET' && u.pathname === '/health') return json(200, { ok: true, service: 'moa-toss-relay', version: 1, ip: S.ip });
    if (method === 'POST' && u.pathname === '/oauth2/token') {
      const f = Object.fromEntries(new URLSearchParams(init.body));
      if (headers['content-type'] !== 'application/x-www-form-urlencoded') return json(400, { error: 'invalid_request' });
      if (f.grant_type !== 'client_credentials' || !f.client_id || !f.client_secret) return json(400, { error: 'invalid_request', error_description: 'OAuth 2.0 Parameter: client_secret' });
      S.valid = `tok${++S.n}`;
      return json(200, { access_token: S.valid, token_type: 'Bearer', expires_in: 86400 });
    }
    if (headers.authorization !== 'Bearer ' + S.valid) return json(401, { error: { code: S.valid && headers.authorization ? 'token-revoked' : 'invalid-token', message: '토큰 오류' } });
    const h = S.routes[`${method} ${u.pathname}`];
    return h ? h(c, S) : json(404, { error: { code: 'not-in-mock' } });
  };
  S.count = (method, path) => S.calls.filter(c => c.method === method && c.path === path).length;
  return S;
}

const ctxOf = (extra = {}) => {
  const saved = [], progress = [];
  return { saved, progress, ctx: { relay: 'https://moa-sync.example/', fx: 1337, today: () => '2026-11-16', saveCfg: c => saved.push(JSON.parse(JSON.stringify(c))), progress: t => progress.push(t), ...extra } };
};

// ---------- 예시 데이터 ----------
const holdingItem = (symbol, name, mc, cur, qty, last, avg, purchase, amount, pl) => ({
  symbol, name, marketCountry: mc, currency: cur, quantity: qty, lastPrice: last, averagePurchasePrice: avg,
  marketValue: { purchaseAmount: purchase, amount, amountAfterCost: amount },
  profitLoss: { amount: pl, amountAfterCost: pl, rate: '0.1', rateAfterCost: '0.1' },
  dailyProfitLoss: { amount: '0', rate: '0' }, cost: { commission: '0', tax: null }
});
const HOLDINGS = {
  totalPurchaseAmount: { krw: '650000', usd: '500.00' },
  items: [
    holdingItem('005930', '삼성전자', 'KR', 'KRW', '10', '72000', '65000', '650000', '720000', '70000'),
    holdingItem('TSLA', '테슬라', 'US', 'USD', '2.5', '250.10', '200.00', '500.00', '625.25', '125.25'),
    holdingItem('000660', 'SK하이닉스', 'KR', 'KRW', '0', '200000', '0', '0', '0', '0')
  ]
};

let seqT = 0;
const tx = (type, symbol, date, qty, amount, commission, tax, net, rate, extra = {}) => ({
  transactionType: type, marketCountry: 'US', currency: 'USD', symbol, assetClass: 'STOCK', isinCode: null,
  quantity: qty, filledPrice: null, amount, commission, tax, netAmount: net, exchangeRate: rate,
  settlementDate: date, settled: true, transactionTime: `${date}T06:30:${String(seqT++ % 60).padStart(2, '0')}+09:00`, isCancellation: false, ...extra
});
// 시간 순서대로 적고, API 순서(미결제 먼저, 그다음 결제 완료 최신순)로 바꿔요.
const CHRON = [
  tx('BUY', 'META', '2024-05-01', '5', '2500.00', '2.50', '0', '2502.50', '1360.00'),
  tx('SELL', 'META', '2024-08-01', '5', '2600.00', '2.60', '0.05', '2597.35', '1370.00'),
  tx('BUY', 'AAPL', '2025-01-10', '10', '1500.00', '1.50', '0', '1501.50', '1450.00'),
  tx('BUY', 'AAPL', '2025-06-10', '10', '2000.00', '2.00', '0', '2002.00', '1380.00'),
  tx('SELL', 'AAPL', '2025-09-15', '5', '1100.00', '1.10', '0.04', '1098.86', '1390.00'),
  tx('BUY', 'GOOG', '2026-01-05', '4', '600.00', '0.60', '0', '600.60', '1470.00'),
  tx('SELL', 'NVDA', '2026-02-02', '2', '260.00', '0.26', '0.01', '259.73', '1440.00'),
  tx('SELL', '005930', '2026-03-03', '5', '360000', '50', '720', '359230', null, { marketCountry: 'KR', currency: 'KRW' }),
  tx('SELL', 'AAPL', '2026-03-05', '15', '3600.00', '3.60', '0.08', '3596.32', '1452.10'),
  tx('BUY', 'TSLA', '2026-04-01', '2.5', '500.00', '0.50', '0', '500.50', '1400.00'),
  tx('SELL', 'MSFT', '2026-05-05', '3', '1200.00', '1.20', '0.03', '1198.77', '1460.00', { isCancellation: true }),
  tx('SELL', 'AAPL261218C00200000', '2026-05-06', '1', '300.00', '0.65', '0', '299.35', '1460.00', { assetClass: 'OPTION' }),
  tx('SELL', 'GOOG', '2026-06-10', '4', '720.00', '0.72', '0.02', '719.26', '1480.00')
];
const UNSETTLED = [tx('SELL', 'TSLA', '2026-11-17', '1', '255.00', '0.25', '0', '254.75', null, { settled: false, transactionTime: null })];
const API_ORDER = [...UNSETTLED, ...[...CHRON].reverse()];

function txRoute(pages) {
  return c => {
    const i = c.query.cursor ? Number(c.query.cursor.slice(1)) : 0;
    const last = i === pages.length - 1;
    return json(200, { result: { transactions: pages[i], nextCursor: last ? null : `c${i + 1}`, hasNext: !last } });
  };
}

function fullRoutes(extra = {}) {
  return {
    'GET /api/v1/accounts': () => json(200, { result: [{ accountNo: '12345678901', accountSeq: 7, accountType: 'BROKERAGE' }] }),
    'GET /api/v1/holdings': () => json(200, { result: HOLDINGS }),
    'GET /api/v1/transactions': txRoute([API_ORDER.slice(0, 6), API_ORDER.slice(6)]),
    ...extra
  };
}
const plain = x => JSON.parse(JSON.stringify(x));
const baseCfg = () => ({ client_id: 'tsck_live_abc', client_secret: 's_secret' });

// ---------- 테스트 ----------
test('register: id·이름·입력칸·함수', () => {
  const { def } = load(async () => { throw new Error('no'); });
  assert.equal(def.id, 'toss');
  assert.equal(def.name, '토스증권');
  assert.deepEqual(def.fields.map(f => f.key), ['client_id', 'client_secret', 'relay']);
  assert.equal(def.fields[1].secret, true);
  assert.equal(def.fields[2].optional, true);
  assert.equal(typeof def.refresh, 'function');
  assert.equal(typeof def.quote, 'function');
  assert.ok(def.help.includes('허용 IP 관리'));
});

test('refresh: 보유 종목(Holding)과 해외 실현손익(Realized), 거래내역 쪽 넘기기', async () => {
  const S = mockToss({ routes: fullRoutes() });
  const { def } = load(S.fetch);
  const cfg = baseCfg(), { ctx, saved, progress } = ctxOf();
  const out = plain(await def.refresh(cfg, ctx));

  assert.deepEqual(out.kr, [{ code: '005930', name: '삼성전자', market: 'KR', qty: 10, avg: 65000, price: 72000, cur: 'KRW', value: 720000, pl: 70000 }]);
  assert.deepEqual(out.us, [{ code: 'TSLA', name: '테슬라', market: 'US', qty: 2.5, avg: 200, price: 250.1, cur: 'USD', value: 625.25, pl: 125.25 }]);

  // 2025 AAPL: 평균원가 = (1501.50×1450 + 2002.00×1380) / 20 = 246,996.75원 → 5주 원가 1,234,983.75
  //            차익 = 1098.86×1390 − 1,234,983.75 = 292,431.65
  // 2026 AAPL: 남은 원가 3,704,951.25 → 차익 = 3596.32×1452.10 − 3,704,951.25 = 1,517,265.02
  // 2026 GOOG: 원가 600.60×1470 = 882,882 → 차익 = 719.26×1480 − 882,882 = 181,622.8
  assert.deepEqual(Object.keys(out.realized).sort(), ['2025', '2026']);
  assert.deepEqual(out.realized[2025], [
    { date: '2025-09-15', code: 'AAPL', name: 'AAPL', qty: 5, gain: 292432, proceeds: 1529000, basis: 1234984, exrt: 1390 }
  ]);
  assert.deepEqual(out.realized[2026], [
    { date: '2026-03-05', code: 'AAPL', name: 'AAPL', qty: 15, gain: 1517265, proceeds: 5227560, basis: 3704951, exrt: 1452.1 },
    { date: '2026-06-10', code: 'GOOG', name: 'GOOG', qty: 4, gain: 181623, proceeds: 1065600, basis: 882882, exrt: 1480 }
  ]);
  // 계산 방식 안내 + 토스에서 산 기록이 없는 NVDA 매도 안내 (취소 내역 MSFT·옵션·국내·미결제는 건너뜀)
  assert.ok(out.warn.some(w => w.includes('이동평균법')), out.warn.join('\n'));
  const shortWarn = out.warn.find(w => w.includes('산 기록이 없는'));
  assert.ok(shortWarn && shortWarn.includes('NVDA 2026-02-02 2주'), out.warn.join('\n'));
  assert.ok(!/MSFT|AAPL2612|005930|TSLA/.test(shortWarn));
  assert.ok(!out.warn.some(w => w.includes('환율이 비어')));

  // 요청 모양: 계좌 헤더, 쪽 넘기기, 거래 유형, 한 번에 100건
  const txCalls = S.calls.filter(c => c.path === '/api/v1/transactions');
  assert.equal(txCalls.length, 2);
  assert.ok(txCalls.every(c => c.headers['x-tossinvest-account'] === '7' && c.headers.authorization === 'Bearer tok1'));
  assert.ok(txCalls.every(c => c.search.includes('transactionTypes=BUY,SELL') && c.query.limit === '100'));
  assert.equal(txCalls[0].query.cursor, undefined);
  assert.equal(txCalls[1].query.cursor, 'c1');
  assert.equal(S.calls.find(c => c.path === '/api/v1/holdings').headers['x-tossinvest-account'], '7');
  assert.equal(S.calls.find(c => c.path === '/api/v1/accounts').headers['x-tossinvest-account'], undefined);
  assert.equal(S.calls[0].path, '/health');
  // 주문 같은 다른 경로는 부르지 않아요
  assert.deepEqual([...new Set(S.calls.map(c => `${c.method} ${c.path}`))].sort(),
    ['GET /api/v1/accounts', 'GET /api/v1/holdings', 'GET /api/v1/transactions', 'GET /health', 'POST /oauth2/token']);

  // 토큰은 cfg에 저장
  assert.equal(cfg.token, 'tok1');
  assert.equal(cfg.tokenClient, 'tsck_live_abc');
  assert.ok(cfg.tokenExp > Date.now() + 86000 * 1000);
  assert.equal(saved.at(-1).token, 'tok1');
  assert.ok(progress.some(p => p.includes('거래내역')));
});

test('토큰: 수명 동안 재사용, 만료 직전·다른 Client ID면 새로 받기', async () => {
  const S = mockToss({ routes: fullRoutes() });
  const { def } = load(S.fetch);
  const cfg = baseCfg(), { ctx } = ctxOf();
  await def.refresh(cfg, ctx);
  await def.refresh(cfg, ctx);
  await def.quote(cfg, ctx, []);
  assert.equal(S.count('POST', '/oauth2/token'), 1);

  // 이 기기를 다시 열어도(새 모듈) 저장된 토큰을 써요
  const again = load(S.fetch).def;
  await again.refresh(JSON.parse(JSON.stringify(cfg)), ctx);
  assert.equal(S.count('POST', '/oauth2/token'), 1);

  cfg.tokenExp = Date.now() + 60 * 1000; // 5분 안에 끝남 → 새로 받기
  await def.refresh(cfg, ctx);
  assert.equal(S.count('POST', '/oauth2/token'), 2);
  assert.equal(cfg.token, 'tok2');

  cfg.client_id = 'tsck_live_other';
  await def.refresh(cfg, ctx);
  assert.equal(S.count('POST', '/oauth2/token'), 3);
  assert.equal(cfg.tokenClient, 'tsck_live_other');
});

test('토큰이 다른 곳에서 새로 발급돼 무효(token-revoked)면 한 번만 새로 받고 다시 시도', async () => {
  const S = mockToss({ routes: fullRoutes() });
  const { def } = load(S.fetch);
  const cfg = { ...baseCfg(), token: 'old', tokenClient: 'tsck_live_abc', tokenExp: Date.now() + 3600e3 };
  S.valid = 'issued-elsewhere';
  const out = await def.refresh(cfg, ctxOf().ctx);
  assert.equal(out.kr.length, 1);
  assert.equal(S.count('POST', '/oauth2/token'), 1);
  assert.equal(S.count('GET', '/api/v1/accounts'), 2);
  assert.equal(cfg.token, 'tok1');

  // 계속 401이면 무한 반복하지 않고 알려요
  const S2 = mockToss({ routes: fullRoutes({ 'GET /api/v1/accounts': () => json(401, { error: { code: 'expired-token', message: '토큰이 만료되었습니다.' } }) }) });
  const d2 = load(S2.fetch).def;
  await assert.rejects(d2.refresh(baseCfg(), ctxOf().ctx), /토스 로그인이 풀렸어요/);
  assert.equal(S2.count('GET', '/api/v1/accounts'), 2);
  assert.equal(S2.count('POST', '/oauth2/token'), 2);
});

test('중계 프로그램이 꺼져 있으면 친절한 안내', async () => {
  const S = mockToss({ down: true });
  const { def } = load(S.fetch);
  await assert.rejects(def.refresh(baseCfg(), ctxOf().ctx), e => e.message.startsWith('집 PC에서 토스 중계 프로그램을 켜 주세요'));
  await assert.rejects(def.quote(baseCfg(), ctxOf().ctx, [{ key: 'a', market: 'KR', code: '005930' }]), /토스 중계 프로그램을 켜 주세요/);

  // 다른 프로그램이 그 주소에 있으면
  const S2 = mockToss({ hook: c => c.path === '/health' ? json(200, { ok: true }) : null });
  await assert.rejects(load(S2.fetch).def.refresh(baseCfg(), ctxOf().ctx), /토스 중계 프로그램을 찾지 못했어요/);
});

test('중계 주소를 바꾸면 그 주소로 불러요', async () => {
  const S = mockToss({ base: 'http://127.0.0.1:9999', routes: fullRoutes() });
  const { def } = load(S.fetch);
  const out = await def.refresh({ ...baseCfg(), relay: ' 127.0.0.1:9999/ ' }, ctxOf().ctx);
  assert.equal(out.kr.length, 1);
});

test('IP 미등록: 토큰 발급(access_denied)과 일반 API(ip-not-allowed) 모두 IP 등록 안내', async () => {
  const S = mockToss({ hook: c => c.path === '/oauth2/token' ? json(403, { error: 'access_denied', error_description: 'IP address not allowed' }) : null });
  const { def } = load(S.fetch);
  await assert.rejects(def.refresh(baseCfg(), ctxOf().ctx), e => e.message.startsWith('토스에 지금 PC의 IP(1.2.3.4)를 등록해 주세요') && e.message.includes('허용 IP 관리'));

  const S2 = mockToss({ ip: null, routes: fullRoutes({ 'GET /api/v1/holdings': () => json(403, { error: { code: 'ip-not-allowed', message: '허용되지 않은 IP' } }) }) });
  await assert.rejects(load(S2.fetch).def.refresh(baseCfg(), ctxOf().ctx), e => e.message.startsWith('토스에 지금 PC의 IP를 등록해 주세요'));
});

test('키가 틀리거나 비어 있으면 알려 주고, 틀린 키로 다시 시도하지 않아요', async () => {
  const S = mockToss({ hook: c => c.path === '/oauth2/token' ? json(401, { error: 'invalid_client', error_description: 'Client authentication failed: client_secret' }) : null });
  const { def } = load(S.fetch);
  await assert.rejects(def.refresh(baseCfg(), ctxOf().ctx), /Client ID나 Client Secret이 맞지 않아요/);
  assert.equal(S.count('POST', '/oauth2/token'), 1);

  const S2 = mockToss({});
  await assert.rejects(load(S2.fetch).def.refresh({ client_id: ' ', client_secret: 'x' }, ctxOf().ctx), /Client ID와 Client Secret을 넣어 주세요/);
  assert.equal(S2.calls.length, 0);
});

test('429: Retry-After만큼 기다렸다가 다시, 계속이면 안내', async () => {
  let n = 0;
  const S = mockToss({ routes: fullRoutes({
    'GET /api/v1/accounts': () => (n++ === 0
      ? json(429, { error: { code: 'rate-limit-exceeded', message: '요청 한도를 초과했습니다.' } }, { 'Retry-After': '2' })
      : json(200, { result: [{ accountNo: '1', accountSeq: 7, accountType: 'BROKERAGE' }] }))
  }) });
  const { def, delays } = load(S.fetch);
  const out = await def.refresh(baseCfg(), ctxOf().ctx);
  assert.equal(out.kr.length, 1);
  assert.equal(S.count('GET', '/api/v1/accounts'), 2);
  assert.ok(delays.includes(2000), String(delays));

  const S2 = mockToss({ routes: fullRoutes({ 'GET /api/v1/accounts': () => json(429, { error: { code: 'rate-limit-exceeded' } }, { 'Retry-After': '1' }) }) });
  await assert.rejects(load(S2.fetch).def.refresh(baseCfg(), ctxOf().ctx), /요청이 잠깐 많았어요/);
  assert.equal(S2.count('GET', '/api/v1/accounts'), 4);
});

test('거래내역을 못 불러와도 보유 종목은 돌려주고 경고만 해요', async () => {
  const S = mockToss({ routes: fullRoutes({ 'GET /api/v1/transactions': () => json(500, { error: { code: 'internal-error' } }) }) });
  const out = plain(await load(S.fetch).def.refresh(baseCfg(), ctxOf().ctx));
  assert.equal(out.kr.length, 1);
  assert.equal(out.us.length, 1);
  assert.deepEqual(out.realized, {});
  assert.ok(out.warn.some(w => w.includes('실현손익을 못 불러왔어요')), out.warn.join('\n'));
});

test('여러 계좌: 같은 종목은 합치고, 거래내역은 계좌마다 따로 불러요', async () => {
  const H9 = { items: [holdingItem('005930', '삼성전자', 'KR', 'KRW', '5', '72000', '71000', '355000', '360000', '5000')] };
  const S = mockToss({ routes: fullRoutes({
    'GET /api/v1/accounts': () => json(200, { result: [{ accountNo: '1', accountSeq: 7, accountType: 'BROKERAGE' }, { accountNo: '2', accountSeq: 9, accountType: 'BROKERAGE' }] }),
    'GET /api/v1/holdings': c => json(200, { result: c.headers['x-tossinvest-account'] === '9' ? H9 : HOLDINGS }),
    'GET /api/v1/transactions': () => json(200, { result: { transactions: [], nextCursor: null, hasNext: false } })
  }) });
  const out = plain(await load(S.fetch).def.refresh(baseCfg(), ctxOf().ctx));
  assert.deepEqual(out.kr, [{ code: '005930', name: '삼성전자', market: 'KR', qty: 15, avg: 67000, price: 72000, cur: 'KRW', value: 1080000, pl: 75000 }]);
  assert.deepEqual(S.calls.filter(c => c.path === '/api/v1/transactions').map(c => c.headers['x-tossinvest-account']), ['7', '9']);
  assert.deepEqual(out.realized, { 2025: [], 2026: [] });
  assert.ok(!out.warn.some(w => w.includes('이동평균법')));
});

test('일부만 토스에서 산 매도, 환율이 빈 거래', async () => {
  const rows = [
    tx('SELL', 'TSLA', '2026-03-01', '3', '900.00', '0.90', '0.02', '899.08', '1500.00'),
    tx('BUY', 'TSLA', '2026-01-02', '1', '200.00', '0.20', '0', '200.20', '1400.00'),
    tx('SELL', 'AMZN', '2026-02-02', '1', '220.00', '0.22', '0', '219.78', '1500.00'),
    tx('BUY', 'AMZN', '2026-01-02', '1', '200.00', '0.20', '0', '200.20', null)
  ];
  const S = mockToss({ routes: fullRoutes({
    'GET /api/v1/transactions': () => json(200, { result: { transactions: rows, nextCursor: null, hasNext: false } }),
    'GET /api/v1/exchange-rate': c => json(200, { result: { baseCurrency: c.query.baseCurrency, quoteCurrency: c.query.quoteCurrency, rate: '1405', midRate: '1400', basisPoint: '35', rateChangeType: 'UP', validFrom: '', validUntil: '' } })
  }) });
  const out = plain(await load(S.fetch).def.refresh(baseCfg(), ctxOf().ctx));
  // TSLA: 1주만 토스 매수 기록 → 1/3만 계산. 차익 = 899.08/3×1500 − 200.20×1400 = 449,540 − 280,280
  // AMZN: 매수 환율이 비어 오늘 매매기준율 1400 사용. 차익 = 219.78×1500 − 200.20×1400 = 329,670 − 280,280
  assert.deepEqual(out.realized[2026], [
    { date: '2026-02-02', code: 'AMZN', name: 'AMZN', qty: 1, gain: 49390, proceeds: 330000, basis: 280280, exrt: 1500 },
    { date: '2026-03-01', code: 'TSLA', name: '테슬라', qty: 1, gain: 169260, proceeds: 450000, basis: 280280, exrt: 1500 }
  ]);
  assert.ok(out.warn.some(w => w.includes('TSLA 2026-03-01 2주')), out.warn.join('\n'));
  assert.ok(out.warn.some(w => w.includes('환율이 비어 있는 해외 거래 1건')), out.warn.join('\n'));
  const fx = S.calls.find(c => c.path === '/api/v1/exchange-rate');
  assert.deepEqual(fx.query, { baseCurrency: 'USD', quoteCurrency: 'KRW' });
});

test('quote: 한 번에 묻고, 모르는 종목이 섞여 404면 하나씩 다시', async () => {
  const PRICES = { '005930': ['72000', 'KRW'], AAPL: ['190.50', 'USD'] };
  const S = mockToss({ routes: { 'GET /api/v1/prices': c => {
    const syms = c.query.symbols.split(',');
    if (syms.some(s => !PRICES[s])) return json(404, { error: { code: 'stock-not-found', message: '종목을 찾을 수 없습니다.' } });
    return json(200, { result: syms.map(s => ({ symbol: s, timestamp: null, lastPrice: PRICES[s][0], currency: PRICES[s][1] })) });
  } } });
  const { def } = load(S.fetch);
  const out = plain(await def.quote(baseCfg(), ctxOf().ctx, [
    { key: 'a', market: 'KR', code: '005930' }, { key: 'b', market: 'US', code: 'aapl' },
    { key: 'c', market: 'US', code: 'BAD!' }, { key: 'd', market: 'US', code: 'ZZZZ' }, { key: 'e', market: 'US', code: 'AAPL' }
  ]));
  assert.deepEqual(out, { a: { price: 72000 }, b: { price: 190.5 }, e: { price: 190.5 } });
  const pc = S.calls.filter(c => c.path === '/api/v1/prices').map(c => c.query.symbols);
  assert.deepEqual(pc, ['005930,AAPL,ZZZZ', '005930', 'AAPL', 'ZZZZ']);
  assert.ok(S.calls.filter(c => c.path === '/api/v1/prices').every(c => !c.headers['x-tossinvest-account']));
});

test('quote: 200개씩 나눠 물어봐요', async () => {
  const S = mockToss({ routes: { 'GET /api/v1/prices': c => json(200, { result: c.query.symbols.split(',').map(s => ({ symbol: s, lastPrice: '1', currency: 'USD' })) }) } });
  const items = Array.from({ length: 450 }, (_, i) => ({ key: 'k' + i, market: 'US', code: 'S' + i }));
  const out = await load(S.fetch).def.quote(baseCfg(), ctxOf().ctx, items);
  assert.equal(Object.keys(out).length, 450);
  assert.deepEqual(S.calls.filter(c => c.path === '/api/v1/prices').map(c => c.query.symbols.split(',').length), [200, 200, 50]);
});
