# 앱 원본

두 앱은 이 폴더의 파일을 고쳐서 만들어요. 앱을 고칠 때는 `household/index.html`, `company/index.html`을 직접 고치지 말고 여기 원본을 고친 뒤 빌드하세요.

| 파일 | 만들어지는 곳 | 앱 |
|---|---|---|
| `moa-household.html` | `household/index.html` | 모아 가계부 |
| `money-ledger.html` | `company/index.html` | 돈흐름 장부 |
| `build.js` | | 원본에 문서 뼈대(doctype·head·body)를 씌우고 버전 번호를 찍어요 |
| `tests/` | | 시험 스크립트 |

원본에는 문서 뼈대가 없어요. `<title>`, `<style>`, 본문, `<script>`만 있어요. 이 모양이면 Claude 아티팩트로도 그대로 미리 볼 수 있어요.

## 빌드

저장소 맨 위 폴더에서 실행해요. Node.js만 있으면 되고 설치할 패키지는 없어요.

```bash
node source/build.js v1.9
```

- 버전 번호는 내려받은 파일의 **새 버전 알림**에 쓰여요. 원본 안의 `const APP_VERSION = 'dev';`가 이 번호로 바뀌어요.
- 번호 없이 `node source/build.js`로 돌리면 `dev`로 만들어지고, 이때는 새 버전 확인을 하지 않아요. 릴리스할 때는 꼭 번호를 넣으세요.

## 시험

```bash
node source/tests/run-all.js
```

- 가계부 계산, 문자·캡처 읽기, 동기화(가짜 서버), 알림함, 증권사 연결 3곳과 샘플 시뮬레이션, 새 버전 알림, 토스 중계 프로그램, 알림함 서버를 한 번에 돌려요.
- `moa-fx.js`만 실제 환율 사이트에 물어봐요. 나머지는 인터넷 없이 돌아가요.
- `(오류 없이 실행됨)`이라고 나오는 시험은 결과를 화면에 찍어 주는 시험이에요. 숫자와 분류가 맞는지는 출력으로 확인하세요.
- `update-test.js`는 빌드한 페이지를 보고, 버전이 `v1.8`로 찍혀 있다고 가정해요. 버전을 올리면 이 시험 안의 번호(`v1.8`, `v1.9`)도 같이 올려 주세요.

## 새 버전 내보내기

1. 원본을 고치고 `node source/tests/run-all.js`로 확인해요.
2. 다음 번호로 빌드해요: `node source/build.js v1.9`
3. 커밋하고 올려요. 웹사이트(GitHub Pages)는 1~2분 뒤에 바뀌어요.
   ```bash
   git add -A
   ```
   ```bash
   git commit -m "무엇을 바꿨는지"
   ```
   ```bash
   git push origin main
   ```
4. 내려받기 파일을 올려요. 빌드한 페이지를 이름만 바꿔 올리면 돼요.
   ```bash
   cp household/index.html moa-household.html && cp company/index.html money-ledger.html
   ```
   토스 중계 프로그램이 바뀌었으면 `toss-relay/`의 `README.md`, `relay.mjs`, `start-relay.bat`을 `toss-relay` 폴더째 묶어 `toss-relay.zip`을 새로 만들어요. 안 바뀌었으면 지난 릴리스의 zip을 그대로 받아 쓰면 돼요.
   ```bash
   gh release create v1.9 moa-household.html money-ledger.html toss-relay.zip --title "v1.9" --notes "바뀐 점"
   ```
   올린 뒤 `moa-household.html`, `money-ledger.html`, `toss-relay.zip` 복사본은 지워요. 저장소에 넣지 않아요.
5. 내려받은 파일을 쓰는 사람에게는 앱 위쪽에 "새 버전이 나왔어요"가 떠요. GitHub의 최신 릴리스 번호를 보고 알려 줘요.

## 서버 (Cloudflare Worker)

`sync-worker/`는 동기화, 한국투자증권 중계, 알림함 서버예요. 앱만 바꿨다면 다시 올릴 필요가 없어요. 서버 코드를 바꿨을 때만 올려요.

```bash
cd sync-worker && npx wrangler deploy
```

- `wrangler.toml`에 저장소(KV `MOA_SYNC`)와 알림함(Durable Object `Inbox`)이 적혀 있어요.
- 알림함 약속은 `sync-worker/INBOX.md`, 증권사 모듈 약속은 `household/brokers/README.md`에 있어요.
