// Check the "새 버전" notice in the BUILT pages, pretending to run from a downloaded file (file:).
const fs = require('fs'); const [siteDir] = process.argv.slice(2);
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function run(file, flag, { protocol = 'file:', latest = 'v1.9', stored = null } = {}) {
  const html = fs.readFileSync(`${siteDir}/${file}`, 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();
  const ver = (code.match(/const APP_VERSION = '([^']+)';/) || [])[1];
  const ls = new Map(stored ? [[stored[0], stored[1]]] : []); const localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  const created = [], calls = [];
  const el = () => { const o = { innerHTML: '', className: '', attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector() { return { addEventListener(t, f) { o.later = f; } }; }, remove() { o.removed = true; } }; return o; };
  const mainEl = { prepended: [], prepend(x) { this.prepended.push(x); } };
  const any = () => new Proxy({ innerHTML: '', hidden: false, value: '', textContent: '', dataset: {}, style: {}, clientWidth: 600, classList: { add() {}, remove() {} } }, { get(t, k) { if (k in t) return t[k]; if (k === 'querySelector') return () => any(); if (k === 'querySelectorAll') return () => []; if (k === 'closest') return () => null; return () => any(); }, set(t, k, v) { t[k] = v; return true; } });
  const document = { querySelector: s => s === 'main' ? mainEl : any(), querySelectorAll: () => [], addEventListener() {}, createElement: t => { const e = el(); created.push(e); return e; }, head: any(), visibilityState: 'visible' };
  const window = { [flag]: true, addEventListener() {}, crypto: globalThis.crypto };
  const location = { protocol, hash: '', pathname: '/x/' + file, search: '', hostname: '', origin: 'null' };
  const fetchMock = async (url) => { calls.push(String(url)); if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ tag_name: latest }), { status: 200 }); throw new Error('blocked'); };
  new Function('localStorage', 'document', 'window', 'location', 'history', 'fetch', 'navigator', code)(localStorage, document, window, location, { replaceState() {} }, fetchMock, {});
  return { ver, mainEl, calls, ls, created };
}
(async () => {
  for (const [file, flag, key] of [['household/index.html', '__MOA_TEST__', 'moa.v1.update'], ['company/index.html', '__LEDGER_TEST__', 'money-ledger.v1.update']]) {
    let r = run(file, flag); await new Promise(res => setTimeout(res, 30));
    ok(r.ver === 'v1.8', `${file}: version stamped as ${r.ver}`);
    const b = r.mainEl.prepended[0];
    ok(b && /새 버전이 나왔어요 \(v1\.9\)/.test(b.innerHTML) && b.innerHTML.includes('releases/latest/download/' + (file.startsWith('household') ? 'moa-household.html' : 'money-ledger.html')), `${file}: newer release → banner with the right download link`);
    ok(r.calls.filter(u => u.includes('api.github.com')).length === 1, `${file}: checked GitHub once`);
    b.later(); ok(JSON.parse(r.ls.get(key)).dismissed === 'v1.9' && b.removed, `${file}: '나중에' hides it and remembers`);
    r = run(file, flag, { latest: 'v1.8' }); await new Promise(res => setTimeout(res, 30)); ok(r.mainEl.prepended.length === 0, `${file}: same version → no banner`);
    r = run(file, flag, { protocol: 'https:' }); await new Promise(res => setTimeout(res, 30)); ok(r.calls.length === 0 && r.mainEl.prepended.length === 0, `${file}: on the website → no check, no banner`);
    r = run(file, flag, { stored: [key, JSON.stringify({ latest: 'v1.9', at: Date.now(), dismissed: 'v1.9' })] }); await new Promise(res => setTimeout(res, 30));
    ok(r.calls.length === 0 && r.mainEl.prepended.length === 0, `${file}: checked recently + dismissed → no network, no banner`);
  }
})();
