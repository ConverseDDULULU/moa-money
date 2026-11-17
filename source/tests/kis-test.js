// Test: KIS module + app host integration, with mock responses shaped like the official KIS examples.
const fs = require('fs'); const [htmlPath, kisPath] = process.argv.slice(2);
const code = [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
const kisCode = fs.readFileSync(kisPath, 'utf8');
let tokenCalls = 0;
const J = (o, h = {}) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json', ...h } });
async function mockFetch(url, opt = {}) {
  const u = new URL(url), tr = (opt.headers || {}).tr_id;
  if (u.pathname.endsWith('/kis/token')) { tokenCalls++; const b = JSON.parse(opt.body); if (b.appkey !== 'PSgoodkey') return J({ error_code: 'EGW00103', error_description: 'invalid' }); return J({ access_token: 'tok123', token_type: 'Bearer', expires_in: 86400 }); }
  if ((opt.headers || {}).authorization !== 'Bearer tok123') return J({ rt_cd: '1', msg_cd: 'EGW00123', msg1: 'expired' });
  if (tr === 'TTTC8434R') {
    if (!u.searchParams.get('CTX_AREA_FK100')) return J({ rt_cd: '0', ctx_area_fk100: 'FK1', ctx_area_nk100: 'NK1', output1: [{ pdno: '005930', prdt_name: '삼성전자', hldg_qty: '10', pchs_avg_pric: '61500.0000', pchs_amt: '615000', prpr: '81200', evlu_amt: '812000', evlu_pfls_amt: '197000' }, { pdno: '000000', prdt_name: 'sold', hldg_qty: '0', pchs_amt: '0', prpr: '0', evlu_amt: '0', evlu_pfls_amt: '0' }], output2: [{}] }, { tr_cont: 'M' });
    return J({ rt_cd: '0', output1: [{ pdno: '069500', prdt_name: 'KODEX 200', hldg_qty: '30', pchs_avg_pric: '33505', pchs_amt: '1005150', prpr: '41250', evlu_amt: '1237500', evlu_pfls_amt: '232350' }], output2: [{}] }, { tr_cont: 'D' });
  }
  if (tr === 'TTTS3012R') return J({ rt_cd: '0', output1: [{ ovrs_pdno: 'NVDA', ovrs_item_name: '엔비디아', ovrs_cblc_qty: '20', pchs_avg_pric: '115.3000', now_pric2: '188.200000', ovrs_stck_evlu_amt: '3764.00', frcr_evlu_pfls_amt: '1458.00', ovrs_excg_cd: 'NASD' }], output2: {} }, { tr_cont: 'D' });
  if (tr === 'TTTS3039R') { const y = u.searchParams.get('INQR_STRT_DT').slice(0, 4); return J({ rt_cd: '0', output1: y === '2026' ? [{ trad_day: '20260305', ovrs_pdno: 'NVDA', slcl_qty: '20', ovrs_rlzt_pfls_amt: '1947840', exrt: '1452.10' }] : [], output2: {} }, { tr_cont: 'D' }); }
  if (tr === 'FHKST01010100') return J({ rt_cd: '0', output: { stck_prpr: u.searchParams.get('FID_INPUT_ISCD') === '005930' ? '81500' : '41300' } });
  if (tr === 'HHDFS00000300') { const p = { 'NAS:NVDA': '188.4', 'NYS:SCHD': '29.71' }[u.searchParams.get('EXCD') + ':' + u.searchParams.get('SYMB')] || ''; return J({ rt_cd: '0', output: { last: p } }); }
  return J({ rt_cd: '1', msg1: 'unexpected ' + tr });
}
const ls = new Map(); const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
const els = {}; const mk = () => new Proxy({ innerHTML: '', hidden: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 600, classList: { add() {}, remove() {} } }, { get(t, k) { if (k in t) return t[k]; if (k === 'querySelector') return () => mk(); if (k === 'querySelectorAll') return () => []; if (k === 'closest') return () => null; return () => mk(); }, set(t, k, v) { t[k] = v; return true; } });
const document = { querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], addEventListener() {}, createElement: () => mk(), head: mk(), visibilityState: 'visible' };
const window = { __MOA_TEST__: true, addEventListener() {}, crypto: globalThis.crypto };
const location = { hash: '', pathname: '/moa-money/household/', search: '', hostname: 'converseddululu.github.io', origin: 'https://converseddululu.github.io' };
const history = { replaceState() {} };
const app = new Function('localStorage', 'document', 'window', 'location', 'history', 'fetch', code + `
  return { S, loadWS, save, render, brokerRefresh, FORMS, taxFor, allRealized, netWorth, brokerHoldings, K, LS, book, mergeDocs };`)(localStorage, document, window, location, history, mockFetch);
new Function('window', 'fetch', kisCode)(window, mockFetch);
const wait = async () => { await new Promise(r => setTimeout(r, 50)); while (app.S.brk.kis && app.S.brk.kis.busy) await new Promise(r => setTimeout(r, 50)); };
(async () => {
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  ok(window.MoaBrokers.list.some(m => m.id === 'kis'), 'kis module registered');
  app.loadWS('mine');
  app.FORMS.trade({ id: '', date: '2026-01-05', market: 'US', name: 'SCHD', ticker: 'SCHD', side: 'buy', qty: '10', price: '27', fee: '0', fx: '1440' });
  app.FORMS.trade({ id: '', date: '2026-01-05', market: 'KOSPI', name: '삼성전자', ticker: '005930', side: 'buy', qty: '5', price: '60000', fee: '0', fx: '' }); app.save();
  app.FORMS.broker({ id: 'kis', appkey: 'PSbad', appsecret: 's', account: '12345678-01' }); await wait();
  ok(/App Key가 맞지 않아요/.test((app.S.brk.kis || {}).err || ''), 'bad key message: ' + ((app.S.brk.kis || {}).err));
  const c = app.LS.get(app.K('broker:kis'), {}); delete c.tokenAt; app.LS.set(app.K('broker:kis'), c);
  app.FORMS.broker({ id: 'kis', appkey: 'PSgoodkey', appsecret: 'secret', account: '12345678-01' }); await wait();
  const d = app.S.d.brokers.kis; ok(d && !app.S.brk.kis, 'refresh succeeded');
  ok(d.kr.length === 2 && d.kr[0].avg === 61500 && d.kr[1].name === 'KODEX 200', 'domestic holdings with paging: ' + d.kr.map(h => h.name + ' ' + h.qty).join(', '));
  ok(d.us.length === 1 && d.us[0].price === 188.2 && d.us[0].ex === 'NAS', 'US holdings');
  ok(d.realized[2026] && d.realized[2026][0].gain === 1947840, 'realized 2026 KRW gain');
  ok(app.S.d.prices.SCHD && app.S.d.prices.SCHD.price === 29.71 && app.S.d.prices.SCHD.ex === 'NYS', 'US quote falls back NAS->NYS');
  ok(app.S.d.prices['005930'] && app.S.d.prices['005930'].price === 81500, 'KR quote');
  const t = app.taxFor(app.allRealized(), 2026); ok(t.net === 1947840, 'tax uses broker gain: ' + t.net);
  const bv = app.brokerHoldings().reduce((s, h) => s + h.valueKrw, 0); ok(bv > 0 && app.netWorth().stock >= bv, 'net worth includes broker holdings');
  const before = tokenCalls; await app.brokerRefresh('kis'); ok(tokenCalls === before, 'token reused on 2nd refresh');
  const dump = JSON.stringify(app.S.d); ok(!dump.includes('PSgoodkey') && !dump.includes('tok123'), 'keys and token stay out of synced data');
  app.S.tab = 'stocks'; app.render(); const h = document.querySelector('#v-stocks').innerHTML;
  ok(!/undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder|id|for)="[^"]*"/g, '')) && h.includes('증권사 계좌 보유 종목'), 'stocks view renders');
  const m = app.mergeDocs({ ...app.S.d, brokers: { kis: { at: 1, kr: [] } } }, app.S.d); ok(m.brokers.kis.kr.length === 2, 'sync merge keeps newer broker data');
})();
