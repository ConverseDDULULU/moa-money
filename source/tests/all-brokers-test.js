// Load the app plus kis/kiwoom/toss modules together; check they register and the stocks screen renders.
const fs = require('fs'); const [htmlPath, dir] = process.argv.slice(2);
const code = [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
const ls = new Map(); const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
const els = {}; const mk = () => new Proxy({ innerHTML: '', hidden: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 600, classList: { add() {}, remove() {} } }, { get(t, k) { if (k in t) return t[k]; if (k === 'querySelector') return () => mk(); if (k === 'querySelectorAll') return () => []; if (k === 'closest') return () => null; return () => mk(); }, set(t, k, v) { t[k] = v; return true; } });
const document = { querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], addEventListener() {}, createElement: () => mk(), head: mk(), visibilityState: 'visible' };
const window = { __MOA_TEST__: true, addEventListener() {}, crypto: globalThis.crypto };
const location = { hash: '', pathname: '/moa-money/household/', search: '', hostname: 'converseddululu.github.io', origin: 'https://converseddululu.github.io' };
const noFetch = async () => { throw new Error('no network in this test'); };
const app = new Function('localStorage', 'document', 'window', 'location', 'history', 'fetch', code + `
  return { S, loadWS, render, brokerGuideHtml };`)(localStorage, document, window, location, { replaceState() {} }, noFetch);
for (const id of ['kis', 'kiwoom', 'toss']) new Function('window', 'fetch', 'localStorage', 'document', fs.readFileSync(`${dir}/${id}.js`, 'utf8'))(window, noFetch, localStorage, document);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const mods = window.MoaBrokers.list;
ok(['kis', 'kiwoom', 'toss'].every(id => mods.some(m => m.id === id)), 'all three registered: ' + mods.map(m => m.id).join(','));
for (const m of mods) ok(typeof m.refresh === 'function' && Array.isArray(m.fields) && m.fields.length && m.name, `${m.id}: name/fields/refresh ok (${m.fields.map(f => f.key + (f.secret ? '*' : '')).join(', ')}) quote=${typeof m.quote}`);
app.loadWS('mine'); app.S.tab = 'stocks';
for (const id of ['kis', 'kiwoom', 'toss']) { const h = app.brokerGuideHtml(id); ok(h.includes('data-form="broker"') && !/undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder|id|for|href)="[^"]*"/g, '')), `${id} popup connect form renders`); }
