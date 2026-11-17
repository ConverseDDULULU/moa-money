// 앱 원본(source/*.html)을 GitHub Pages용 페이지로 만들어요.
//   node source/build.js          → household/index.html, company/index.html (버전 'dev')
//   node source/build.js v1.9     → 내려받은 파일의 '새 버전 알림'용 번호를 찍어요. 릴리스할 때는 꼭 번호를 넣어요.
// 원본은 문서 뼈대(doctype/head/body) 없이 <title>, <style>, 본문, <script>만 있어요. 여기서 뼈대를 씌워요.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const VER = process.argv[2];
if (VER && !/^v\d+(\.\d+)*$/.test(VER)) throw new Error('버전은 v1.9 같은 모양이어야 해요: ' + VER);
const head = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n';
for (const [src, dir] of [['moa-household.html', 'household'], ['money-ledger.html', 'company']]) {
  let body = fs.readFileSync(path.join(__dirname, src), 'utf8');
  if (VER) {
    const slot = "const APP_VERSION = 'dev';";
    if (!body.includes(slot)) throw new Error('버전 자리를 못 찾았어요: ' + src);
    body = body.replace(slot, `const APP_VERSION = '${VER}';`);
  }
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  const out = path.join(ROOT, dir, 'index.html');
  fs.writeFileSync(out, head + body + '\n</body></html>\n');
  console.log(`${dir}/index.html ${fs.statSync(out).size} bytes${VER ? ' (' + VER + ')' : ''}`);
}
fs.writeFileSync(path.join(ROOT, '.nojekyll'), '');
