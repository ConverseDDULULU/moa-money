// 토스증권 샘플 응답 테스트: node --test household/brokers/toss.sim.test.mjs
// 본체처럼 toss.js와 toss.sim.js를 브라우저 전역에 불러온 뒤 window.fetch를 샘플 라우터로 바꾸고,
// 진짜 refresh()/quote()가 네트워크 없이 그럴듯한 결과를 내는지 확인해요.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const SAMPLE_CFG = () => ({ client_id: 'tsck_live_SAMPLE', client_secret: 'SAMPLE-SECRET' });
const plain = x => JSON.parse(JSON.stringify(x));
const pad = n => String(n).padStart(2, '0');
const now = new Date(), Y = now.getFullYear(), L = Y - 1;
const TODAY = `${Y}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const RELAY = 'http://127.0.0.1:8790';

// 브라우저 흉내: window === 전역. 처음 fetch는 진짜 네트워크라고 치고 쓰면 실패하게 해 둬요.
function browser() {
  const g = { console, setTimeout, clearTimeout, AbortController, Response, Headers, URL, URLSearchParams };
  g.window = g;
  let def = null;
  g.MoaBrokers = { register: d => { def = d; } };
  g.fetch = async () => { throw new Error('진짜 네트워크를 쓰면 안 돼요'); };
  vm.createContext(g);
  vm.runInContext(read('./toss.js'), g, { filename: 'toss.js' });
  vm.runInContext(read('./toss.sim.js'), g, { filename: 'toss.sim.js' });
  // 본체처럼, 모듈을 불러온 '뒤에' fetch를 바꿔요 (toss.js가 부를 때마다 전역 fetch를 찾는지 확인)
  const seen = [], passed = [];
  g.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const r = await g.MoaBrokerSim.toss(url, init);
    if (r) return r;
    passed.push(String(url));
    throw new TypeError('Failed to fetch');
  };
  return { g, def, sim: g.MoaBrokerSim.toss, seen, passed };
}
const ctxOf = () => ({ fx: 1337, today: () => TODAY, saveCfg: () => {}, progress: () => {}, relay: 'https://moa-sync.example/' });

test('샘플로 refresh: 보유 종목·해외 실현손익이 채워지고 네트워크는 안 써요', async () => {
  const { def, seen, passed } = browser();
  assert.equal(def.id, 'toss');
  const out = plain(await def.refresh(SAMPLE_CFG(), ctxOf()));

  assert.deepEqual(out.kr, [
    { code: '005930', name: '삼성전자', market: 'KR', qty: 30, avg: 61200, price: 71800, cur: 'KRW', value: 2154000, pl: 318000 },
    { code: '035420', name: 'NAVER', market: 'KR', qty: 5, avg: 198500, price: 186000, cur: 'KRW', value: 930000, pl: -62500 },
    { code: '360750', name: 'TIGER 미국S&P500', market: 'KR', qty: 120, avg: 17450, price: 21385, cur: 'KRW', value: 2566200, pl: 472200 }
  ]);
  assert.deepEqual(out.us, [
    { code: 'NVDA', name: '엔비디아', market: 'US', qty: 8, avg: 93.47, price: 181.2, cur: 'USD', value: 1449.6, pl: 701.84 },
    { code: 'TSLA', name: '테슬라', market: 'US', qty: 4, avg: 180.2, price: 238.5, cur: 'USD', value: 954, pl: 233.2 },
    { code: 'SCHD', name: '슈왑 미국 배당주 ETF', market: 'US', qty: 30, avg: 26.1, price: 27.45, cur: 'USD', value: 823.5, pl: 40.5 }
  ]);
  for (const h of [...out.kr, ...out.us]) {
    assert.ok(Math.abs(h.value - h.qty * h.price) < 0.01, h.code);
    assert.ok(Math.abs(h.pl - (h.value - h.qty * h.avg)) < 0.01, h.code);
  }

  // 작년 AAPL 이익: 원가 1401.40×1335.80 = 1,871,990.12 / 매도 정산 1640.72×1398.60 = 2,294,710.99
  // 올해 NVDA 이익: 평균원가 (725.73×1325.40 + 677.68×1452.30)/15 × 7 = 908,169.36 / 매도 1181.09×1471.20 = 1,737,619.61
  // 올해 TSLA 손실: 원가 1082.28×1368.10 × 2/6 = 493,555.76 / 매도 304.49×1440.50 = 438,617.85
  assert.deepEqual(Object.keys(out.realized).sort(), [String(L), String(Y)]);
  assert.deepEqual(out.realized[L], [
    { date: `${L}-11-18`, code: 'AAPL', name: 'AAPL', qty: 8, gain: 422721, proceeds: 2297061, basis: 1871990, exrt: 1398.6 }
  ]);
  const ry = out.realized[Y];
  assert.equal(ry.length, 2);
  assert.deepEqual(ry.map(({ date, ...r }) => r), [
    { code: 'NVDA', name: '엔비디아', qty: 7, gain: 829450, proceeds: 1739400, basis: 908169, exrt: 1471.2 },
    { code: 'TSLA', name: '테슬라', qty: 2, gain: -54938, proceeds: 439064, basis: 493556, exrt: 1440.5 }
  ]);
  for (const r of ry) assert.ok(r.date.startsWith(`${Y}-`) && r.date <= TODAY, r.date);
  for (const r of [...ry, ...out.realized[L]]) assert.ok(r.exrt >= 1300 && r.exrt <= 1480);

  // 경고: 계산 방식 한 줄만 (빠진 매수 기록·빈 환율 없음 → 미결제 SCHD와 취소된 카카오는 조용히 건너뜀)
  assert.equal(out.warn.length, 1, out.warn.join('\n'));
  assert.match(out.warn[0], /이동평균법/);

  // 쪽 넘기기 한 번, 전부 샘플이 처리
  const tx = seen.filter(s => s.url.includes('/api/v1/transactions'));
  assert.equal(tx.length, 2);
  assert.ok(!tx[0].url.includes('cursor='));
  assert.ok(tx[1].url.includes('cursor=SIMp10'));
  assert.ok(seen[0].url.startsWith(RELAY + '/health'));
  assert.deepEqual(passed, []);
});

test('샘플로 quote: 보유 종목은 같은 값, 나머지는 정해진 가짜 값', async () => {
  const { def, passed } = browser();
  const items = [
    { key: 'a', market: 'KR', code: '005930' }, { key: 'b', market: 'US', code: 'NVDA' },
    { key: 'c', market: 'US', code: 'amzn' }, { key: 'd', market: 'KR', code: '000660' }, { key: 'e', market: 'US', code: 'QQQ' }
  ];
  const q1 = plain(await def.quote(SAMPLE_CFG(), ctxOf(), items));
  const q2 = plain(await def.quote(SAMPLE_CFG(), ctxOf(), items));
  assert.deepEqual(q1, q2);
  assert.equal(q1.a.price, 71800);
  assert.equal(q1.b.price, 181.2);
  for (const k of 'abcde') assert.ok(q1[k] && q1[k].price > 0, k);
  assert.ok(q1.d.price >= 5000 && q1.d.price < 200000 && q1.d.price % 100 === 0);
  assert.ok(q1.c.price >= 10 && q1.c.price < 500);
  assert.deepEqual(passed, []);
});

test('샘플 응답 모양이 진짜 중계·토스와 같아요', async () => {
  const { sim } = browser();
  const call = async (path, init = {}) => {
    const r = await sim(RELAY + path, init);
    return { status: r.status, j: await r.json() };
  };
  const auth = { Authorization: 'Bearer sim-1.SAMPLE-ACCESS-TOKEN' };
  const DEC = /^-?\d+(\.\d+)?$/;

  // 중계가 아닌 주소는 null (본체가 그대로 넘겨요)
  assert.equal(await sim('https://openapi.tossinvest.com/api/v1/accounts', {}), null);
  assert.equal(await sim('https://example.com/health', {}), null);
  assert.equal(await sim('not a url', {}), null);

  // 중계: /health, 허용 목록 밖은 403
  assert.deepEqual((await call('/health')).j, { ok: true, service: 'moa-toss-relay', version: 1, ip: '203.0.113.7' });
  const forb = await call('/api/v1/orders', { method: 'POST', headers: auth, body: '{}' });
  assert.equal(forb.status, 403);
  assert.equal(forb.j.error.code, 'relay-forbidden-path');

  // 토큰 (OAuth2 모양)
  const tok = await call('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&client_id=tsck_live_SAMPLE&client_secret=SAMPLE-SECRET' });
  assert.equal(tok.status, 200);
  assert.deepEqual(Object.keys(tok.j).sort(), ['access_token', 'expires_in', 'token_type']);
  assert.equal(tok.j.token_type, 'Bearer');
  const bad = await call('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&client_id=x' });
  assert.deepEqual(bad.j, { error: 'invalid_request', error_description: 'OAuth 2.0 Parameter: client_secret' });

  // 인증·계좌 헤더 오류
  assert.equal((await call('/api/v1/accounts')).j.error.code, 'edge-blocked');
  assert.equal((await call('/api/v1/accounts', { headers: { Authorization: 'Bearer nope' } })).j.error.code, 'invalid-token');
  assert.equal((await call('/api/v1/holdings', { headers: auth })).j.error.code, 'account-header-required');
  assert.equal((await call('/api/v1/holdings', { headers: { ...auth, 'X-Tossinvest-Account': '9' } })).status, 404);

  // 계좌
  const acc = await call('/api/v1/accounts', { headers: auth });
  assert.deepEqual(acc.j, { result: [{ accountNo: '12345678901', accountSeq: 1, accountType: 'BROKERAGE' }] });

  // 보유 주식: 소수 문자열, 요약 금액
  const hd = (await call('/api/v1/holdings', { headers: new Headers({ ...auth, 'X-Tossinvest-Account': '1' }) })).j.result;
  assert.deepEqual(Object.keys(hd).sort(), ['dailyProfitLoss', 'items', 'marketValue', 'profitLoss', 'totalPurchaseAmount']);
  assert.equal(hd.totalPurchaseAmount.krw, String(1836000 + 992500 + 2094000));
  assert.equal(hd.totalPurchaseAmount.usd, '2251.56');
  for (const it of hd.items) {
    for (const v of [it.quantity, it.lastPrice, it.averagePurchasePrice, it.marketValue.purchaseAmount, it.marketValue.amount, it.marketValue.amountAfterCost,
      it.profitLoss.amount, it.profitLoss.amountAfterCost, it.profitLoss.rate, it.profitLoss.rateAfterCost, it.dailyProfitLoss.amount, it.dailyProfitLoss.rate, it.cost.commission]) {
      assert.equal(typeof v, 'string'); assert.match(v, DEC);
    }
    assert.ok(it.cost.tax === null || DEC.test(it.cost.tax));
    assert.ok(['KR', 'US'].includes(it.marketCountry) && ['KRW', 'USD'].includes(it.currency));
  }
  const one = (await call('/api/v1/holdings?symbol=TSLA', { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).j.result;
  assert.deepEqual(one.items.map(i => i.symbol), ['TSLA']);
  assert.equal(one.totalPurchaseAmount.krw, '0');

  // 거래내역: 미결제 먼저, 결제 완료는 최신순, 필터·쪽 넘기기·잘못된 커서
  const all = [];
  let cursor = null;
  do {
    const r = (await call('/api/v1/transactions?transactionTypes=BUY,SELL&limit=100' + (cursor ? `&cursor=${cursor}` : ''), { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).j.result;
    assert.deepEqual(Object.keys(r).sort(), ['hasNext', 'nextCursor', 'transactions']);
    all.push(...r.transactions);
    cursor = r.nextCursor;
  } while (cursor);
  assert.equal(all.length, 14);
  assert.equal(all[0].settled, false);
  assert.equal(all[0].exchangeRate, null);
  assert.equal(all[0].transactionTime, null);
  assert.ok(all[0].settlementDate > TODAY);
  const done = all.slice(1);
  assert.ok(done.every(t => t.settled && t.transactionTime));
  assert.ok(done.every((t, i) => i === 0 || done[i - 1].transactionTime >= t.transactionTime));
  assert.equal(done.filter(t => t.isCancellation).length, 1);
  assert.ok(done.filter(t => t.currency === 'USD').every(t => DEC.test(t.exchangeRate)));
  assert.ok(done.filter(t => t.currency === 'KRW').every(t => t.exchangeRate === null));
  const keys = ['amount', 'assetClass', 'commission', 'currency', 'exchangeRate', 'filledPrice', 'isCancellation', 'isinCode', 'marketCountry', 'netAmount', 'quantity', 'settled', 'settlementDate', 'symbol', 'tax', 'transactionTime', 'transactionType'];
  assert.ok(all.every(t => JSON.stringify(Object.keys(t).sort()) === JSON.stringify(keys)));
  const sells = (await call(`/api/v1/transactions?transactionTypes=SELL&from=${L}-01-01&to=${L}-12-31&limit=100`, { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).j.result;
  assert.deepEqual(sells.transactions.map(t => t.symbol), ['AAPL']);
  assert.equal((await call('/api/v1/transactions?cursor=bogus', { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).status, 400);
  assert.equal((await call('/api/v1/transactions?transactionTypes=BUY,ORDER', { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).status, 400);
  assert.equal((await call('/api/v1/transactions?limit=101', { headers: { ...auth, 'X-Tossinvest-Account': '1' } })).status, 400);

  // 현재가·환율
  const pr = (await call('/api/v1/prices?symbols=005930,AAPL', { headers: auth })).j.result;
  assert.deepEqual(pr.map(p => [p.symbol, p.currency]), [['005930', 'KRW'], ['AAPL', 'USD']]);
  assert.ok(pr.every(p => DEC.test(p.lastPrice) && /\+09:00$/.test(p.timestamp)));
  assert.equal((await call('/api/v1/prices', { headers: auth })).status, 400);
  const fx = (await call('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW', { headers: auth })).j.result;
  assert.equal(fx.midRate, '1337.00');
  assert.equal(fx.rate, '1342.35');
  assert.deepEqual(Object.keys(fx).sort(), ['baseCurrency', 'basisPoint', 'midRate', 'quoteCurrency', 'rate', 'rateChangeType', 'validFrom', 'validUntil']);
  assert.equal((await call('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=USD', { headers: auth })).status, 400);
});
