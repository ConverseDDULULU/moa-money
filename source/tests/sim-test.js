// Run "샘플로 해 보기" for each broker whose module + sim file exist, inside the real app code.
const fs = require('fs'); const [htmlPath, dir] = process.argv.slice(2);
const code = [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
const ls = new Map(); const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
const els = {}; const mk = () => new Proxy({ innerHTML: '', hidden: false, open: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 600, classList: { add() {}, remove() {} } }, { get(t, k) { if (k in t) return t[k]; if (k === 'querySelector') return () => mk(); if (k === 'querySelectorAll') return () => []; if (k === 'closest') return () => null; if (k === 'showModal') return function () { t.open = true; }; if (k === 'close') return function () { t.open = false; }; return () => mk(); }, set(t, k, v) { t[k] = v; return true; } });
const document = { querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], addEventListener() {}, createElement: () => mk(), head: mk(), visibilityState: 'visible' };
let netCalls = [];
const realNet = async (url) => { netCalls.push(String(url)); throw new Error('network blocked in test'); };
const window = { __MOA_TEST__: true, addEventListener() {}, crypto: globalThis.crypto, fetch: realNet };
const location = { hash: '', pathname: '/moa-money/household/', search: '', hostname: 'converseddululu.github.io', origin: 'https://converseddululu.github.io' };
// modules call bare `fetch`; route it to window.fetch so the host's temporary override applies
const fetchProxy = (...a) => window.fetch(...a);
const app = new Function('localStorage', 'document', 'window', 'location', 'history', 'fetch', code + `
  return { S, loadWS, render, brokerSimulate, openBrokerGuide, taxFor, allRealized, brokerHoldings };`)(localStorage, document, window, location, { replaceState() {} }, fetchProxy);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const ids = ['kis', 'kiwoom', 'toss'].filter(id => fs.existsSync(`${dir}/${id}.js`));
  for (const id of ids) {
    new Function('window', 'fetch', 'localStorage', 'document', fs.readFileSync(`${dir}/${id}.js`, 'utf8'))(window, fetchProxy, localStorage, document);
    if (fs.existsSync(`${dir}/${id}.sim.js`)) new Function('window', 'Response', fs.readFileSync(`${dir}/${id}.sim.js`, 'utf8'))(window, Response);
  }
  app.loadWS('sample');
  for (const id of ids) {
    app.openBrokerGuide(id); const dh = document.querySelector('#dlg-broker').innerHTML;
    ok(dh.includes('키 넣기') && dh.includes('샘플로 해 보기') && !/undefined|NaN/.test(dh.replace(/(data-[a-z]+|value|placeholder|id|for|href)="[^"]*"/g, '')), `${id}: popup renders${dh.includes('ipbox') ? ' (with IP box)' : ''}`);
    if (!(window.MoaBrokerSim && window.MoaBrokerSim[id])) { console.log(`SKIP ${id}: no sim file yet`); continue; }
    netCalls = [];
    await app.brokerSimulate(id);
    const d = app.S.d.brokers && app.S.d.brokers[id];
    ok(d && d.sample && (d.kr.length + d.us.length) > 0, `${id}: sample holdings kr=${d ? d.kr.length : 0} us=${d ? d.us.length : 0} ${app.S.brk[id] && app.S.brk[id].err ? 'ERR ' + app.S.brk[id].err : ''}`);
    const yrs = d ? Object.keys(d.realized) : []; ok(yrs.length && Object.values(d.realized).some(a => a.length), `${id}: realized years ${yrs.join(',')} rows ${yrs.map(y => d.realized[y].length).join('/')}`);
    ok(window.fetch === realNet, `${id}: fetch restored after simulation`);
    ok(!netCalls.some(u => /kiwoom|tossinvest|koreainvestment|127\.0\.0\.1|workers\.dev\/kis/.test(u)), `${id}: no real broker network calls (${netCalls.length} passthrough: ${[...new Set(netCalls.map(u => new URL(u).host))].join(',')})`);
  }
  const t = app.taxFor(app.allRealized(), new Date().getFullYear()); console.log('combined this-year US net', Math.round(t.net), 'tax', t.total, '| broker holdings', app.brokerHoldings().length);
  app.S.tab = 'stocks'; app.render(); const h = document.querySelector('#v-stocks').innerHTML;
  ok(!/undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder|id|for|href)="[^"]*"/g, '')) && h.includes('샘플'), 'stocks view renders sample broker data');
  ok(ls.size === 0 || ![...ls.keys()].some(k => k.includes('broker:')), 'simulation stored no broker keys on the device');
})();
