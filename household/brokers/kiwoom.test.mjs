// 키움 연결 모듈 테스트 (실제 키 없이, 키움 API 명세의 예시 응답 모양으로 흉내 내요)
// 실행: node household/brokers/kiwoom.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./kiwoom.js', import.meta.url)), 'utf8');
const TODAY = '2026-11-16';
const ALLOWED = new Set(['token', 'kt00018', 'ust21070', 'ust21530', 'ka10001', 'usa10098', 'usa20100']);
const PATHS = {
  token: '/oauth2/token', kt00018: '/api/dostk/acnt', ust21070: '/api/us/acnt', ust21530: '/api/us/acnt',
  ka10001: '/api/dostk/stkinfo', usa10098: '/api/us/stkinfo', usa20100: '/api/us/mrkcond'
};

/* ---------- 모듈 불러오기 (브라우저 전역 흉내) ---------- */

function load(fetchImpl) {
  const sleeps = [];
  const registered = [];
  const window = { MoaBrokers: { register: b => registered.push(b) } };
  const fakeTimeout = (fn, ms) => { sleeps.push(ms); fn(); return 0; };
  new Function('window', 'fetch', 'setTimeout', SRC)(window, fetchImpl, fakeTimeout);
  assert.equal(registered.length, 1, 'register는 한 번만');
  return { broker: registered[0], sleeps };
}

function makeCtx() {
  const saved = [], said = [];
  return {
    saved, said,
    relay: 'https://example.invalid/', fx: 1400,
    today: () => TODAY,
    saveCfg: c => saved.push(JSON.parse(JSON.stringify(c))),
    progress: t => said.push(t)
  };
}

/* ---------- 키움 서버 흉내 ---------- */

function res(json, headers = {}, status = 200) {
  const h = { 'cont-yn': 'N', 'next-key': '' };
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: k => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
    json: async () => { if (json === undefined) throw new SyntaxError('not json'); return json; }
  };
}
const ok = (body, headers) => res({ ...body, return_code: 0, return_msg: '조회가 완료되었습니다' }, headers);
const kwErr = (code, text) => res({ return_msg: `인증에 실패했습니다[${code}:${text}]`, return_code: 3 });

function kstStamp(ms) { return new Date(ms + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14); }
function tokenOk(n) {
  return res({ expires_dt: kstStamp(Date.now() + 24 * 3600e3), token_type: 'bearer', token: 'TKN-' + n,
    return_code: 0, return_msg: '정상적으로 처리되었습니다' });
}

function server(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(init.method, 'POST');
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.kiwoom.com');
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    const id = headers['api-id'] || (u.pathname === '/oauth2/token' ? 'token' : '?');
    assert.ok(ALLOWED.has(id), '허용되지 않은 TR 호출: ' + id);
    assert.equal(u.pathname, PATHS[id], id + ' 경로');
    assert.equal(headers['content-type'], 'application/json;charset=UTF-8');
    const c = { id, path: u.pathname, headers, body: JSON.parse(init.body) };
    calls.push(c);
    const n = calls.filter(x => x.id === id).length;
    const h = routes[id];
    if (!h) throw new Error('mock에 없는 TR: ' + id);
    return h(c, n);
  };
  return { fetch, calls, of: id => calls.filter(c => c.id === id) };
}

/* ---------- 명세 예시 응답 ---------- */

// kt00018 예시 (openapi.kiwoom.com 명세 그대로) — 1쪽
const KT00018_P1 = {
  tot_pur_amt: '000000017598258', tot_evlt_amt: '000000025789890', tot_evlt_pl: '000000008138825',
  tot_prft_rt: '46.25', prsm_dpst_aset_amt: '000001012632507', tot_loan_amt: '000000000000000',
  tot_crd_loan_amt: '000000000000000', tot_crd_ls_amt: '000000000000000',
  acnt_evlt_remn_indv_tot: [
    { stk_cd: 'A005930', stk_nm: '삼성전자', evltv_prft: '-00000000196888', prft_rt: '-52.71',
      pur_pric: '000000000124500', pred_close_pric: '000000045400', rmnd_qty: '000000000000003',
      trde_able_qty: '000000000000003', cur_prc: '000000059000', pred_buyq: '000000000000000',
      pred_sellq: '000000000000000', tdy_buyq: '000000000000000', tdy_sellq: '000000000000000',
      pur_amt: '000000000373500', pur_cmsn: '000000000000050', evlt_amt: '000000000177000',
      sell_cmsn: '000000000000020', tax: '000000000000318', sum_cmsn: '000000000000070',
      poss_rt: '2.12', crd_tp: '00', crd_tp_nm: '', crd_loan_dt: '' },
    { stk_cd: 'A005930', stk_nm: '삼성전자', evltv_prft: '-00000000995004', prft_rt: '-59.46',
      pur_pric: '000000000209178', pred_close_pric: '000000097600', rmnd_qty: '000000000000008',
      trde_able_qty: '000000000000008', cur_prc: '000000085000', pred_buyq: '000000000000000',
      pred_sellq: '000000000000000', tdy_buyq: '000000000000000', tdy_sellq: '000000000000000',
      pur_amt: '000000001673430', pur_cmsn: '000000000000250', evlt_amt: '000000000680000',
      sell_cmsn: '000000000000100', tax: '000000000001224', sum_cmsn: '000000000000350',
      poss_rt: '9.51', crd_tp: '00', crd_tp_nm: '', crd_loan_dt: '' }
  ]
};
// 2쪽 (같은 모양으로 만든 줄): 현재가에 하락 부호, 다 판 종목(수량 0)
const KT00018_P2 = {
  ...KT00018_P1,
  acnt_evlt_remn_indv_tot: [
    { stk_cd: 'A000660', stk_nm: 'SK하이닉스', evltv_prft: '000000000245560', prft_rt: '12.28',
      pur_pric: '000000000200000', pred_close_pric: '000000226000', rmnd_qty: '000000000000010',
      trde_able_qty: '000000000000010', cur_prc: '-00000225000', pur_amt: '000000002000000',
      evlt_amt: '000000002250000', sum_cmsn: '000000000000740', crd_tp: '00' },
    { stk_cd: 'A035720', stk_nm: '카카오', evltv_prft: '000000000000000', pur_pric: '000000000041000',
      rmnd_qty: '000000000000000', cur_prc: '+00000043000', evlt_amt: '000000000000000', crd_tp: '00' }
  ]
};

// ust21070 예시 (명세 그대로) + 같은 모양 한 줄
const UST21070 = {
  stex_tp: '000030', crnc_code: 'USD', tot_evlt_amt: '156464.6701', tot_prch_amt: '157279.9717',
  tot_pl_amt: '-1599.6616', tot_pl_rt: '-1.01', tdy_book_amt: '0.0000', tdy_pl_amt: '0.0000', tdy_pl_rt: '0.00',
  tot_evlt_amt_krw: '000000238530390', tot_prch_amt_krw: '000000239773317', tot_pl_amt_krw: '-00000002438684',
  tdy_book_amt_krw: '000000000000000', tdy_pl_amt_krw: '000000000000000',
  result_list: [
    { stex_nm: '미국', crnc_code: 'USD', stk_cd: 'AAPL', frgn_stk_nm: '애플', qty: '000000000395',
      poss_qty: '000000000395', sell_alowq: '000000000395', pred_cntr_sellq: '000000000000',
      pred_cntr_buyq: '000000000000', tdy_cntr_sellq: '000000000000', tdy_cntr_buyq: '000000000000',
      frgn_stk_book_uv: '282.1603', now_pric: '275.2400', evlt_amt: '108719.8000', pl_amt: '-3283.9512',
      pl_rt: '-2.94', evlt_amt_krw: '000165743335', pl_amt_krw: '-00005006383', natn_nm: '미국',
      exch_rate: '1524.50', frgn_stk_book_uv_krw: '000000430153', now_pric_krw: '000000419603',
      frgn_stk_book_amt: '111453.3212', frgn_stk_book_amt_krw: '000169910588' },
    { stex_nm: '미국', crnc_code: 'USD', stk_cd: 'nvda', frgn_stk_nm: '엔비디아', qty: '000000000010',
      poss_qty: '000000000012', frgn_stk_book_uv: '150.0000', now_pric: '+201.4700', evlt_amt: '2417.6400',
      pl_amt: '000617.6400', exch_rate: '1524.50' },
    { stex_nm: '미국', crnc_code: 'USD', stk_cd: 'TSLA', frgn_stk_nm: '테슬라', poss_qty: '000000000000',
      frgn_stk_book_uv: '0.0000', now_pric: '400.0000', evlt_amt: '0.0000', pl_amt: '0.0000' }
  ]
};

// ust21530 예시 (명세 그대로, fc_krw_tp=1 원화)
const R_TSLA = {
  sell_dt: '20260611', stk_cd: 'TSLA', frgn_stk_nm: '테슬라', sell_qty: '000000000001',
  avg_buy_uv: '671460.00', buy_amt: '671457.00', avg_sell_uv: '589614.00', sell_amt: '589614.00',
  cmsn_tax: '3165.00', pl_amt: '-85008.00', pl_rt: '-12.66', prch_exrt: '1460.60', sell_exrt: '1546.50',
  krw_chg_dfrn_pl_amt: '000000000037967', krw_chg_pl_amt: '-00000000048352', comm_ord_tp: 'AB',
  stex_nm: '나스닥', natn_nm: '미국'
};
const R_NVDA = { ...R_TSLA, sell_dt: '20261002', stk_cd: 'NVDA', frgn_stk_nm: '엔비디아', sell_qty: '000000000004',
  buy_amt: '1100000.00', sell_amt: '1261243.00', cmsn_tax: '1500.00', pl_amt: '159743.00',
  prch_exrt: '1350.00', sell_exrt: '1390.10' };
const R_AAPL_2025 = { ...R_TSLA, sell_dt: '20251229', stk_cd: 'AAPL', frgn_stk_nm: '애플', sell_qty: '000000000003',
  buy_amt: '600000.00', sell_amt: '750000.00', cmsn_tax: '2000.00', pl_amt: '148000.00', sell_exrt: '1470.25' };
const R_STRAY_2024 = { ...R_AAPL_2025, sell_dt: '20241230' };
const UST21530_TOT = { tot_sell_amt: '3680466.00', tot_buy_amt: '3681135.00', tot_cmsn_tax: '16910.00',
  tot_exct_amt: '3663556.00', tot_pl_amt: '-17579.00', tot_pl_rt: '-0.47' };

function happyRoutes(extra = {}) {
  return {
    token: (c, n) => tokenOk(n),
    kt00018: (c, n) => n === 1 ? ok(KT00018_P1, { 'cont-yn': 'Y', 'next-key': 'K1' }) : ok(KT00018_P2),
    ust21070: () => ok(UST21070),
    ust21530: c => {
      const { strt_dt, end_dt } = c.body;
      if (strt_dt === '20260101' && end_dt === '20261116') {
        return c.headers['next-key'] === 'R2'
          ? ok({ ...UST21530_TOT, result_list: [R_NVDA] })
          : ok({ ...UST21530_TOT, result_list: [R_TSLA] }, { 'cont-yn': 'Y', 'next-key': 'R2' });
      }
      if (strt_dt === '20250101' && end_dt === '20251231') return ok({ ...UST21530_TOT, result_list: [R_AAPL_2025, R_STRAY_2024] });
      throw new Error('예상 밖 기간 ' + strt_dt + '~' + end_dt);
    },
    ...extra
  };
}

const plain = x => JSON.parse(JSON.stringify(x));
const KEYS = () => ({ appkey: 'APPKEY-1', secretkey: 'SECRET-1' });

/* ---------- 테스트 ---------- */

test('README 약속대로 한 번 등록해요', () => {
  const { broker } = load(async () => { throw new Error('no fetch at load'); });
  assert.equal(broker.id, 'kiwoom');
  assert.equal(broker.name, '키움증권');
  assert.deepEqual(plain(broker.fields), [
    { key: 'appkey', label: 'App Key' },
    { key: 'secretkey', label: 'Secret Key', secret: true }
  ]);
  assert.equal(typeof broker.help, 'string');
  assert.match(broker.help, /IP/);
  assert.match(broker.notes, /등록한 IP/);
  assert.equal(typeof broker.refresh, 'function');
  assert.equal(typeof broker.quote, 'function');
});

test('refresh: 토큰 → 국내 잔고(연속조회) → 미국 잔고 → 미국 실현손익(원화)', async () => {
  const s = server(happyRoutes());
  const { broker, sleeps } = load(s.fetch);
  const ctx = makeCtx();
  const cfg = KEYS();
  const out = plain(await broker.refresh(cfg, ctx));

  // 토큰
  const tk = s.of('token');
  assert.equal(tk.length, 1);
  assert.deepEqual(tk[0].body, { grant_type: 'client_credentials', appkey: 'APPKEY-1', secretkey: 'SECRET-1' });
  assert.equal(tk[0].headers.authorization, undefined);
  assert.equal(cfg.token, 'TKN-1');
  assert.equal(cfg.tokenFor, 'APPKEY-1');
  assert.ok(Math.abs(cfg.tokenExp - (Date.now() + 24 * 3600e3)) < 5000, '만료 시각은 한국시간 expires_dt 기준');
  assert.ok(ctx.saved.some(c => c.token === 'TKN-1'), 'saveCfg로 토큰 저장');

  // 모든 조회에 Bearer 토큰
  for (const c of s.calls.filter(c => c.id !== 'token')) assert.equal(c.headers.authorization, 'Bearer TKN-1');

  // 국내 잔고 연속조회
  const kt = s.of('kt00018');
  assert.equal(kt.length, 2);
  assert.deepEqual(kt[0].body, { qry_tp: '1', dmst_stex_tp: 'KRX' });
  assert.equal(kt[0].headers['cont-yn'], undefined);
  assert.equal(kt[1].headers['cont-yn'], 'Y');
  assert.equal(kt[1].headers['next-key'], 'K1');
  assert.deepEqual(kt[1].body, kt[0].body);
  assert.ok(sleeps.some(ms => ms >= 1000), 'kt00018은 초당 1회라 다음 쪽 전에 1초 넘게 쉬어요');

  assert.deepEqual(out.kr, [
    { code: '005930', name: '삼성전자', market: 'KR', qty: 11, avg: 186084, price: 59000, cur: 'KRW', value: 857000, pl: -1191892 },
    { code: '000660', name: 'SK하이닉스', market: 'KR', qty: 10, avg: 200000, price: 225000, cur: 'KRW', value: 2250000, pl: 245560 }
  ]);

  // 미국 잔고
  assert.deepEqual(s.of('ust21070')[0].body, { stex_tp: '', stk_cd: '' });
  assert.deepEqual(out.us, [
    { code: 'AAPL', name: '애플', market: 'US', qty: 395, avg: 282.1603, price: 275.24, cur: 'USD', value: 108719.8, pl: -3283.9512 },
    { code: 'NVDA', name: '엔비디아', market: 'US', qty: 12, avg: 150, price: 201.47, cur: 'USD', value: 2417.64, pl: 617.64 }
  ]);

  // 실현손익: 올해(연속조회) + 작년, 원화로
  const r = s.of('ust21530');
  assert.equal(r.length, 3);
  assert.deepEqual(r[0].body, { strt_dt: '20260101', end_dt: '20261116', fc_krw_tp: '1' });
  assert.equal(r[1].headers['next-key'], 'R2');
  assert.deepEqual(r[2].body, { strt_dt: '20250101', end_dt: '20251231', fc_krw_tp: '1' });
  assert.deepEqual(out.realized, {
    2026: [
      { date: '2026-06-11', code: 'TSLA', name: '테슬라', qty: 1, gain: -85008, proceeds: 589614, basis: 671457, exrt: 1546.5 },
      { date: '2026-10-02', code: 'NVDA', name: '엔비디아', qty: 4, gain: 159743, proceeds: 1261243, basis: 1100000, exrt: 1390.1 }
    ],
    2025: [
      { date: '2025-12-29', code: 'AAPL', name: '애플', qty: 3, gain: 148000, proceeds: 750000, basis: 600000, exrt: 1470.25 }
    ]
  });
  // 명세 예시 검산: 손익 = 매도금액 - 매입금액 - 수수료제세금
  assert.equal(589614 - 671457 - 3165, -85008);

  assert.equal(out.warn.length, 1);
  assert.match(out.warn[0], /키움이 계산한 원화 손익/);
  assert.deepEqual(ctx.said, ['키움 국내 잔고 불러오는 중…', '키움 해외 잔고 불러오는 중…', '키움 해외 실현손익 불러오는 중…']);
});

test('저장된 토큰은 다시 쓰고, 만료됐거나 다른 App Key면 새로 받아요', async () => {
  // 유효한 토큰
  let s = server(happyRoutes());
  let m = load(s.fetch);
  let cfg = { ...KEYS(), token: 'SAVED', tokenFor: 'APPKEY-1', tokenExp: Date.now() + 5 * 3600e3 };
  await m.broker.refresh(cfg, makeCtx());
  assert.equal(s.of('token').length, 0);
  assert.equal(s.of('kt00018')[0].headers.authorization, 'Bearer SAVED');

  // 만료 5분 전 → 새로
  s = server(happyRoutes());
  m = load(s.fetch);
  cfg = { ...KEYS(), token: 'SAVED', tokenFor: 'APPKEY-1', tokenExp: Date.now() + 5 * 60e3 };
  await m.broker.refresh(cfg, makeCtx());
  assert.equal(s.of('token').length, 1);
  assert.equal(cfg.token, 'TKN-1');

  // App Key를 바꿈 → 새로
  s = server(happyRoutes());
  m = load(s.fetch);
  cfg = { appkey: 'APPKEY-2', secretkey: 'S2', token: 'SAVED', tokenFor: 'APPKEY-1', tokenExp: Date.now() + 5 * 3600e3 };
  await m.broker.refresh(cfg, makeCtx());
  assert.equal(s.of('token').length, 1);
  assert.equal(s.of('token')[0].body.appkey, 'APPKEY-2');
});

test('키를 안 넣으면 바로 알려요', async () => {
  const s = server({});
  const { broker } = load(s.fetch);
  await assert.rejects(broker.refresh({ appkey: ' ', secretkey: '' }, makeCtx()), { message: 'App Key와 Secret Key를 넣어 주세요.' });
  assert.equal(s.calls.length, 0);
});

test('8050 IP 미등록 → "키움에 등록한 IP(집 와이파이)에서 열어 주세요"', async () => {
  const s = server({ token: () => kwErr(8050, 'IP가 등록되지 않았습니다. 키움 REST API 홈페이지 > API 사용신청 화면에서 IP를 등록해주세요.') });
  const { broker } = load(s.fetch);
  await assert.rejects(broker.refresh(KEYS(), makeCtx()), err => {
    assert.match(err.message, /^키움에 등록한 IP\(집 와이파이\)에서 열어 주세요/);
    return true;
  });
  assert.equal(s.calls.length, 1, '잔고 조회는 시도하지 않아요');

  // return_code 자체가 8050으로 오는 경우도
  const s2 = server({ token: () => res({ return_code: 8050, return_msg: 'IP가 등록되지 않았습니다.' }) });
  await assert.rejects(load(s2.fetch).broker.refresh(KEYS(), makeCtx()), /등록한 IP/);
});

test('8010 토큰 IP 불일치 → 저장된 토큰을 버리고 한 번 다시 받아서 성공', async () => {
  const s = server(happyRoutes({
    kt00018: (c, n) => c.headers.authorization === 'Bearer OLD'
      ? kwErr(8010, 'Token을 발급받은 IP와 서비스를 요청한 IP가 동일하지 않습니다')
      : (c.headers['next-key'] ? ok(KT00018_P2) : ok(KT00018_P1, { 'cont-yn': 'Y', 'next-key': 'K1' }))
  }));
  const { broker } = load(s.fetch);
  const ctx = makeCtx();
  const cfg = { ...KEYS(), token: 'OLD', tokenFor: 'APPKEY-1', tokenExp: Date.now() + 5 * 3600e3 };
  const out = await broker.refresh(cfg, ctx);
  assert.equal(s.of('token').length, 1);
  assert.equal(s.of('kt00018').length, 3);
  assert.equal(cfg.token, 'TKN-1');
  assert.ok(ctx.saved.some(c => c.token === ''), '버린 토큰도 저장');
  assert.equal(out.kr.length, 2);
});

test('8010이 다시 나도 한 번만 재시도하고 IP 안내로 멈춰요', async () => {
  const s = server({ token: (c, n) => tokenOk(n), kt00018: () => kwErr(8010, 'Token을 발급받은 IP와 서비스를 요청한 IP가 동일하지 않습니다') });
  const { broker } = load(s.fetch);
  await assert.rejects(broker.refresh(KEYS(), makeCtx()), /등록한 IP\(집 와이파이\)/);
  assert.equal(s.of('kt00018').length, 2);
  assert.equal(s.of('token').length, 2);
});

test('키가 틀리면(8001) 다시 넣어 달라고 해요', async () => {
  const s = server({ token: () => kwErr(8001, 'App Key와 Secret Key 검증에 실패했습니다') });
  await assert.rejects(load(s.fetch).broker.refresh(KEYS(), makeCtx()), /App Key나 Secret Key가 맞지 않아요/);
});

test('모의투자 키(8030)면 실전 키를 달라고 해요', async () => {
  const s = server({ token: () => kwErr(8030, '투자구분(실전/모의)이 달라서 Appkey를 사용할수가 없습니다') });
  await assert.rejects(load(s.fetch).broker.refresh(KEYS(), makeCtx()), /모의투자용 키예요/);
});

test('"조회할 자료가 없습니다"는 오류가 아니라 빈 목록', async () => {
  const empty = () => res({ return_code: 20, return_msg: '조회할 자료가 없습니다' });
  const s = server({ token: (c, n) => tokenOk(n), kt00018: empty, ust21070: empty, ust21530: empty });
  const out = plain(await load(s.fetch).broker.refresh(KEYS(), makeCtx()));
  assert.deepEqual(out.kr, []);
  assert.deepEqual(out.us, []);
  assert.deepEqual(out.realized, { 2026: [], 2025: [] });
  assert.equal(s.of('ust21530').length, 2);
});

test('해외 조회가 막힌 계좌 → 국내는 그대로, 해외는 빈 목록 + 경고', async () => {
  const no = () => res({ return_code: 2, return_msg: '해외주식 거래 신청이 필요합니다' });
  const s = server(happyRoutes({ ust21070: no, ust21530: no }));
  const out = plain(await load(s.fetch).broker.refresh(KEYS(), makeCtx()));
  assert.equal(out.kr.length, 2);
  assert.deepEqual(out.us, []);
  assert.deepEqual(out.realized, {});
  assert.equal(out.warn.length, 3);
  assert.match(out.warn[0], /^키움 해외 잔고를 불러오지 못했어요 \(키움에서 오류가 났어요: 해외주식 거래 신청이 필요합니다\)$/);
  assert.match(out.warn[1], /^2026년 키움 해외 실현손익을 불러오지 못했어요/);
  assert.match(out.warn[2], /^2025년 /);
  // 연도 전체가 거절되면 1월만 한 번 더 물어보고 멈춰요
  assert.equal(s.of('ust21530').length, 4);
});

test('실현손익: 1년 조회가 거절되면 한 달씩 나눠 물어봐요', async () => {
  const s = server(happyRoutes({
    ust21530: c => {
      const { strt_dt, end_dt } = c.body;
      if (strt_dt.endsWith('0101') && !end_dt.slice(4).startsWith('01')) return res({ return_code: 2, return_msg: '조회기간은 최대 3개월입니다' });
      if (strt_dt === '20260601') return ok({ result_list: [R_TSLA] });
      if (strt_dt === '20251201') return ok({ result_list: [R_AAPL_2025] });
      return ok({ result_list: [] });
    }
  }));
  const out = plain(await load(s.fetch).broker.refresh(KEYS(), makeCtx()));
  const ranges = s.of('ust21530').map(c => c.body.strt_dt + '-' + c.body.end_dt);
  assert.equal(ranges.length, 1 + 11 + 1 + 12);
  assert.equal(ranges[1], '20260101-20260131');
  assert.equal(ranges[2], '20260201-20260228');
  assert.equal(ranges[11], '20261101-20261116');
  assert.equal(ranges[12], '20250101-20251231');
  assert.equal(ranges[24], '20251201-20251231');
  assert.deepEqual(out.realized[2026].map(x => x.code), ['TSLA']);
  assert.deepEqual(out.realized[2025].map(x => x.code), ['AAPL']);
});

test('호출 한도(1700) → 잠깐 쉬고 다시', async () => {
  const s = server(happyRoutes({
    ust21070: (c, n) => n === 1 ? kwErr(1700, '허용된 API 요청 개수를 초과하였습니다. 유량=5, API ID=ust21070') : ok(UST21070)
  }));
  const { broker, sleeps } = load(s.fetch);
  const out = await broker.refresh(KEYS(), makeCtx());
  assert.equal(s.of('ust21070').length, 2);
  assert.ok(sleeps.includes(1100));
  assert.equal(out.us.length, 2);
});

test('호출 한도가 계속되면 잠시 뒤 다시 하라고 해요', async () => {
  const s = server({ token: (c, n) => tokenOk(n), kt00018: () => kwErr(1700, '허용된 API 요청 개수를 초과하였습니다') });
  await assert.rejects(load(s.fetch).broker.refresh(KEYS(), makeCtx()), /키움 조회가 잠시 몰렸어요/);
  assert.equal(s.of('kt00018').length, 3);
});

test('네트워크 오류·HTTP 오류는 쉬운 말로', async () => {
  const net = load(async () => { throw new TypeError('Failed to fetch'); }).broker;
  await assert.rejects(net.refresh(KEYS(), makeCtx()), /키움에 연결하지 못했어요/);

  const s = server({ token: (c, n) => tokenOk(n), kt00018: () => res(undefined, {}, 502) });
  await assert.rejects(load(s.fetch).broker.refresh(KEYS(), makeCtx()), /HTTP 502/);
});

test('국내 잔고가 모르는 오류면 refresh 전체를 멈춰요 (예전 잔고를 지우지 않게)', async () => {
  const s = server({ token: (c, n) => tokenOk(n), kt00018: () => kwErr(1999, '예기치 못한 에러가 발생했습니다. 실패사유=timeout') });
  await assert.rejects(load(s.fetch).broker.refresh(KEYS(), makeCtx()), {
    message: '키움에서 오류가 났어요: 예기치 못한 에러가 발생했습니다. 실패사유=timeout'
  });
  assert.equal(s.of('ust21070').length, 0);
});

test('quote: 국내는 ka10001, 미국은 거래소를 찾아 usa20100, 거래소는 기억해요', async () => {
  const s = server({
    token: (c, n) => tokenOk(n),
    ka10001: c => ok({ stk_cd: c.body.stk_cd, stk_nm: '삼성전자', cur_prc: '-59000', oyr_hgst: '+181400' }),
    usa10098: c => ok({ list: [{ stex_tp: 'ND', stk_cd: c.body.stk_cd, stk_nm: '엔비디아', stk_enm: 'NVIDIA CORP', mkgb: 'NASDAQ', upgb: '반도체', isEtf: 'N' }] }),
    usa20100: c => c.body.stex_tp === 'ND'
      ? ok({ stex_tp: 'ND', stk_cd: c.body.stk_cd, stk_nm: '엔비디아', cur_prc: '+201.4700', '52wk_lwst_pric': '-145.5000', base_exrt: '1520.80' })
      : res({ return_code: 3, return_msg: '종목 정보가 없습니다[1903:종목 정보가 없습니다. 입력한 종목코드, 거래소구분 값을 확인바랍니다.]' })
  });
  const { broker } = load(s.fetch);
  const ctx = makeCtx();
  const cfg = KEYS();
  const items = [{ key: 'a', market: 'KR', code: '005930' }, { key: 'b', market: 'US', code: 'nvda' }];
  const q = plain(await broker.quote(cfg, ctx, items));
  assert.deepEqual(q, { a: { price: 59000 }, b: { price: 201.47, ex: 'NAS' } });
  assert.deepEqual(s.of('ka10001')[0].body, { stk_cd: '005930' });
  assert.deepEqual(s.of('usa10098')[0].body, { stk_cd: 'NVDA' });
  assert.deepEqual(s.of('usa20100')[0].body, { stex_tp: 'ND', stk_cd: 'NVDA' });
  assert.equal(cfg.usEx.NVDA, 'ND');
  assert.ok(ctx.saved.some(c => c.usEx && c.usEx.NVDA === 'ND'));

  // 두 번째는 거래소를 다시 묻지 않아요
  await broker.quote(cfg, ctx, [items[1]]);
  assert.equal(s.of('usa10098').length, 1);
  assert.equal(s.of('usa20100').length, 2);
  assert.equal(s.of('token').length, 1);
});

test('quote: 거래소를 못 찾으면 나스닥 → 뉴욕 → 아멕스 순서로, 없는 종목은 건너뛰어요', async () => {
  const s = server({
    token: (c, n) => tokenOk(n),
    usa10098: () => ok({ list: [] }),
    usa20100: c => (c.body.stk_cd === 'KO' && c.body.stex_tp === 'NY')
      ? ok({ stk_cd: 'KO', cur_prc: '-70.1200' })
      : res({ return_code: 3, return_msg: '[1903:종목 정보가 없습니다]' })
  });
  const q = plain(await load(s.fetch).broker.quote(KEYS(), makeCtx(), [
    { key: 'ko', market: 'US', code: 'KO' }, { key: 'zz', market: 'US', code: 'ZZZZ' }
  ]));
  assert.deepEqual(q, { ko: { price: 70.12, ex: 'NYS' } });
  assert.deepEqual(s.of('usa20100').map(c => c.body.stk_cd + '@' + c.body.stex_tp),
    ['KO@ND', 'KO@NY', 'ZZZZ@ND', 'ZZZZ@NY', 'ZZZZ@NA']);
});

test('quote: IP 문제는 숨기지 않고 알려요', async () => {
  const s = server({ token: () => kwErr(8050, 'IP가 등록되지 않았습니다') });
  await assert.rejects(load(s.fetch).broker.quote(KEYS(), makeCtx(), [{ key: 'a', market: 'KR', code: '005930' }]), /등록한 IP/);
});

test('동시에 refresh와 quote를 불러도 토큰은 한 번만 받아요', async () => {
  const s = server(happyRoutes({ ka10001: () => ok({ cur_prc: '59000' }) }));
  const { broker } = load(s.fetch);
  const cfg = KEYS();
  await Promise.all([
    broker.refresh(cfg, makeCtx()),
    broker.quote(cfg, makeCtx(), [{ key: 'a', market: 'KR', code: 'A005930' }])
  ]);
  assert.equal(s.of('token').length, 1);
  assert.deepEqual(s.of('ka10001')[0].body, { stk_cd: '005930' });
});
