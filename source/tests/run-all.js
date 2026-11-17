// 시험을 한 번에 돌려요. 저장소 맨 위에서: node source/tests/run-all.js
// moa-fx.js만 환율 사이트(Frankfurter)에 실제로 물어봐요. 나머지는 인터넷 없이 돌아가요. 먼저 node source/build.js vX.Y 로 페이지를 만들어 두세요 (update-test가 만든 페이지를 봐요).
const { spawnSync } = require('child_process'); const path = require('path');
const R = path.resolve(__dirname, '..', '..'), T = __dirname;
const H = path.join(R, 'source', 'moa-household.html'), C = path.join(R, 'source', 'money-ledger.html'), B = path.join(R, 'household', 'brokers');
const runs = [
  ['moa.js', H], ['moa-fx.js', H], ['sms.js', H], ['ocr.js', H], ['inbox-app-test.js', H],
  ['kis-test.js', H, path.join(B, 'kis.js')], ['sim-test.js', H, B], ['all-brokers-test.js', H, B],
  ['sync2.js', H, path.join(R, 'sync-worker', 'src', 'index.js')], ['update-test.js', R],
  ['views.js', C], ['check.js', C],
].map(([f, ...a]) => [f, [path.join(T, f), ...a]]);
const mjs = ['household/brokers/kiwoom.test.mjs', 'household/brokers/kiwoom.sim.test.mjs', 'household/brokers/toss.test.mjs', 'household/brokers/toss.sim.test.mjs', 'toss-relay/relay.test.mjs', 'sync-worker/test/inbox.test.mjs'];
for (const m of mjs) runs.push([m, [path.join(R, m)]]);
let bad = 0;
for (const [name, args] of runs) {
  const r = spawnSync(process.execPath, args, { cwd: R, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^(PASS|ok)\b/gm) || []).length, fail = (out.match(/^(FAIL|not ok)\b/gm) || []).length;
  const good = r.status === 0 && fail === 0;
  if (!good) bad++;
  console.log(`${good ? '✓' : '✗'} ${name}  ${pass + fail ? `(${pass} pass${fail ? ', ' + fail + ' fail' : ''})` : '(오류 없이 실행됨 · 출력은 눈으로 확인하는 시험)'}`);
  if (!good) console.log(out.split('\n').filter(l => /FAIL|not ok|Error/.test(l)).slice(0, 8).map(l => '    ' + l).join('\n'));
}
console.log(bad ? `\n${bad}개 묶음에서 실패했어요.` : '\n모두 통과했어요.');
process.exitCode = bad ? 1 : 0;
