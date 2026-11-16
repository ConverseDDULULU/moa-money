// 키움 샘플 응답(kiwoom.sim.js)으로 진짜 kiwoom.js를 돌려 보는 테스트
// 실행: node household/brokers/kiwoom.sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = f => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const MODULE = read('./kiwoom.js');
const SIM = read('./kiwoom.sim.js');
const SAMPLE = () => ({ appkey: 'SAMPLE-APPKEY', secretkey: 'SAMPLE-SECRET' });
const plain = x => JSON.parse(JSON.stringify(x));
const p2 = n => String(n).padStart(2, '0');
const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`; };
const ctx = () => ({ relay: '', fx: 1450, today: localToday, saveCfg: () => {}, progress: () => {} });

// 브라우저 흉내: window가 곧 전역이고, 본체는 모듈을 불러온 '뒤에' fetch를 샘플 라우터로 갈아 끼워요.
// kiwoom.js가 fetch를 불러올 때 붙잡아 두었다면 아래 '진짜 네트워크' 함수가 불려서 테스트가 실패해요.
function browser() {
  const g = { Response, URL, console, setTimeout: fn => { fn(); return 0; } };
  g.window = g;
  const registered = [];
  g.MoaBrokers = { register: b => registered.push(b) };
  g.fetch = async url => { throw new Error('진짜 네트워크로 나갔어요: ' + url); };
  vm.createContext(g);
  vm.runInContext(SIM, g, { filename: 'kiwoom.sim.js' });
  vm.runInContext(MODULE, g, { filename: 'kiwoom.js' });
  assert.equal(registered.length, 1);

  const calls = [], escaped = [], realFetch = g.fetch;
  g.fetch = async (url, init) => {
    const r = await g.MoaBrokerSim.kiwoom(url, init);
    if (r) {
      calls.push({ id: (init.headers && init.headers['api-id']) || 'token', body: JSON.parse(init.body), headers: init.headers });
      return r;
    }
    escaped.push(String(url));
    return realFetch(url, init);
  };
  return { g, broker: registered[0], calls, escaped };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≈ ${b}`);

test('샘플은 키움 주소와 샘플 키·토큰에만 답해요', async () => {
  const { g } = browser();
  const sim = g.MoaBrokerSim.kiwoom;
  const post = (path, body, headers = {}) => sim('https://api.kiwoom.com' + path,
    { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8', ...headers }, body: JSON.stringify(body) });

  assert.equal(await sim('https://moa-sync.moa-sync.workers.dev/kis/token', { method: 'POST', body: '{}' }), null);
  assert.equal(await sim('not a url', {}), null);
  assert.equal(await post('/oauth2/token', { grant_type: 'client_credentials', appkey: 'REAL-KEY', secretkey: 'x' }), null);
  assert.equal(await post('/api/dostk/acnt', { qry_tp: '1', dmst_stex_tp: 'KRX' }, { 'api-id': 'kt00018', authorization: 'Bearer REAL-TOKEN' }), null);

  const t = await (await post('/oauth2/token', { grant_type: 'client_credentials', ...SAMPLE() })).json();
  assert.equal(t.return_code, 0);
  assert.match(t.expires_dt, /^\d{14}$/);
  const auth = { authorization: 'Bearer ' + t.token };

  const bad = await (await post('/api/us/ordr', { stk_cd: 'AAPL' }, { ...auth, 'api-id': 'ust20000' })).json();
  assert.notEqual(bad.return_code, 0);
  assert.match(bad.return_msg, /\[1505:/);

  // 명세와 같은 형식: 0채움 부호 문자열, 'A' 접두어, 연속조회 헤더
  const r = await post('/api/dostk/acnt', { qry_tp: '1', dmst_stex_tp: 'KRX' }, { ...auth, 'api-id': 'kt00018' });
  assert.equal(r.headers.get('cont-yn'), 'Y');
  assert.ok(r.headers.get('next-key'));
  const j = await r.json();
  const row = j.acnt_evlt_remn_indv_tot[0];
  assert.match(row.stk_cd, /^A\d{6}$/);
  assert.match(row.rmnd_qty, /^\d{15}$/);
  assert.match(row.cur_prc, /^\d{12}$/);
  assert.match(j.tot_evlt_amt, /^\d{15}$/);
  const r2 = await post('/api/dostk/acnt', { qry_tp: '1', dmst_stex_tp: 'KRX' },
    { ...auth, 'api-id': 'kt00018', 'cont-yn': 'Y', 'next-key': r.headers.get('next-key') });
  assert.equal(r2.headers.get('cont-yn'), 'N');
  const all = j.acnt_evlt_remn_indv_tot.concat((await r2.json()).acnt_evlt_remn_indv_tot);
  assert.equal(all.length, 4);
  assert.ok(all.some(x => /^-\d{14}$/.test(x.evltv_prft)), '손실 종목은 음수 0채움');
});

test('샘플로 refresh: 국내 4종목(연속조회), 미국 3종목, 올해·작년 실현손익', async () => {
  const { broker, calls, escaped } = browser();
  const today = localToday(), year = +today.slice(0, 4);
  const out = plain(await broker.refresh(SAMPLE(), ctx()));
  assert.deepEqual(escaped, [], '네트워크로 나간 요청 없음');

  const kt = calls.filter(c => c.id === 'kt00018');
  assert.equal(kt.length, 2, '연속조회 한 번');
  assert.equal(kt[1].headers['cont-yn'], 'Y');
  assert.equal(kt[1].headers['next-key'], 'SAMPLE-NEXT-2');

  assert.deepEqual(out.kr.map(h => h.code), ['005930', '000660', '069500', '035420']);
  for (const h of out.kr) {
    assert.equal(h.market, 'KR'); assert.equal(h.cur, 'KRW');
    assert.ok(Number.isInteger(h.qty) && h.qty > 0 && h.avg > 0 && h.price > 0, h.code);
    assert.equal(h.value, h.qty * h.price, h.code + ' 평가금액 = 수량 × 현재가');
    const gross = h.value - h.qty * h.avg;
    assert.ok(h.pl < gross && gross - h.pl <= h.value * 0.005, h.code + ' 손익은 수수료·세금만큼 조금 작아요');
  }
  assert.ok(out.kr.some(h => h.pl > 0) && out.kr.some(h => h.pl < 0), '이익·손실 종목이 섞여 있어요');

  assert.deepEqual(out.us.map(h => [h.code, h.cur]), [['AAPL', 'USD'], ['MSFT', 'USD'], ['VOO', 'USD']]);
  for (const h of out.us) {
    assert.equal(h.market, 'US');
    assert.ok(h.qty > 0 && h.avg > 0 && h.price > 0, h.code);
    near(h.value, h.qty * h.price, 0.01, h.code + ' 평가금액');
    near(h.pl, h.value - h.qty * h.avg, 0.01, h.code + ' 평가손익');
  }

  assert.deepEqual(Object.keys(out.realized).sort(), [String(year - 1), String(year)]);
  const now = out.realized[year], last = out.realized[year - 1];
  assert.equal(now.length, 2);
  assert.equal(last.length, 1);
  assert.ok(now.some(r => r.gain > 0) && now.some(r => r.gain < 0), '올해는 이익 1건, 손실 1건');
  for (const [y, rows] of [[year, now], [year - 1, last]]) {
    for (const r of rows) {
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(r.date.slice(0, 4), String(y));
      assert.ok(r.date <= today, '오늘 이후 매도는 없어요');
      assert.ok(r.code && r.name && r.qty > 0 && r.proceeds > 0 && r.basis > 0, r.code);
      const fees = r.proceeds - r.basis - r.gain;
      assert.ok(fees > 0 && fees < (r.proceeds + r.basis) * 0.01, r.code + ' 차익 = 양도가액 - 취득가액 - 수수료');
      assert.ok(r.exrt >= 1300 && r.exrt <= 1480, r.code + ' 환율 ' + r.exrt);
    }
  }
  assert.equal(out.warn.length, 1);
  assert.match(out.warn[0], /키움이 계산한 원화 손익/);
});

test('샘플로 quote: 어떤 종목이든 늘 같은 가짜 가격', async () => {
  const items = [
    { key: 'sam', market: 'KR', code: '005930' }, { key: 'kr?', market: 'KR', code: '123450' },
    { key: 'aapl', market: 'US', code: 'AAPL' }, { key: 'voo', market: 'US', code: 'VOO' },
    { key: 'ko', market: 'US', code: 'KO' }, { key: 'us?', market: 'US', code: 'ZQXW' },
    { key: 'bad', market: 'KR', code: '!!' }
  ];
  const a = browser(), b = browser();
  const q1 = plain(await a.broker.quote(SAMPLE(), ctx(), items));
  const q2 = plain(await b.broker.quote(SAMPLE(), ctx(), items));
  assert.deepEqual(a.escaped, []);
  assert.deepEqual(q1, q2, '두 번 물어도 같은 값');

  assert.deepEqual(q1.sam, { price: 81200 });
  assert.ok(q1['kr?'].price >= 5000 && q1['kr?'].price < 300000 && q1['kr?'].price % 100 === 0);
  assert.deepEqual(q1.aapl, { price: 236.4, ex: 'NAS' });
  assert.deepEqual(q1.voo, { price: 571.8, ex: 'AMS' });
  assert.deepEqual(q1.ko, { price: 70.12, ex: 'NYS' });
  assert.ok(q1['us?'].price >= 10 && q1['us?'].price < 600);
  assert.ok(['NAS', 'NYS'].includes(q1['us?'].ex));
  assert.equal(q1.bad, undefined, '이상한 코드는 건너뛰어요');
});

test('샘플 결과는 실행할 때마다 같아요', async () => {
  const one = plain(await browser().broker.refresh(SAMPLE(), ctx()));
  const two = plain(await browser().broker.refresh(SAMPLE(), ctx()));
  assert.deepEqual(one, two);
});
