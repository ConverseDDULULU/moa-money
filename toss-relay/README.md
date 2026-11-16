# 토스증권 중계 프로그램 (모아 가계부)

토스증권 Open API는 **미리 등록한 IP에서만** 받아 주고, 브라우저에서 바로 부를 수 없어요.
그래서 집 PC에서 이 작은 프로그램을 켜 두고, **같은 PC의 브라우저**에서 모아 가계부를 열어 토스증권을 불러와요.
동기화를 켜 두면 불러온 결과가 휴대폰에도 보여요.

- 이 PC 안(`127.0.0.1:8790`)에서만 받아요. 다른 기기나 인터넷에서는 접속할 수 없어요.
- 조회 6가지(로그인 토큰, 계좌 목록, 보유 주식, 거래내역, 현재가, 환율)만 토스로 넘기고 **주문·취소는 모두 막아요.**
- 키·토큰을 저장하거나 기록에 남기지 않아요.

## 처음 한 번 준비 (10분쯤)

1. **Node.js 설치** — <https://nodejs.org> 에서 **LTS** 버전을 받아 설치해요. 이미 있으면 건너뛰어요.
2. **프로그램 받기** — <https://github.com/ConverseDDULULU/moa-money/releases/latest/download/toss-relay.zip> 을 받아
   찾기 쉬운 곳(예: 문서)에 압축을 풀어요. `toss-relay` 폴더가 생겨요.
3. **켜기** — `toss-relay` 폴더의 `start-relay.bat`을 더블클릭해요.
   'Windows의 PC 보호' 창이 뜨면 **추가 정보 → 실행**을 눌러요.
   검은 창에 `토스 '허용 IP 관리'에 등록할 이 PC의 IP: 123.45.67.89`처럼 나와요.
4. **IP 등록** — 토스증권 **PC 웹**에 로그인 → **설정 → Open API** → 아래쪽 **허용 IP 관리**에 3번의 IP를 넣어요.
   창에 IP가 안 나오면, 이 PC 브라우저에서 <https://api.ipify.org> 를 열었을 때 보이는 숫자를 넣으면 돼요.
5. **키 발급** — 같은 Open API 화면에서 **Client ID**(`tsck_live_`로 시작)와 **Client Secret**을 발급받아요.
6. **연결** — 이 PC 브라우저에서 모아 가계부 → 증권사 연결 → **토스증권**에 Client ID와 Client Secret을 넣고 불러와요.
   브라우저가 '로컬 네트워크의 기기에 접근'을 허용할지 물으면 **허용**을 눌러요.

## 평소에는

- 토스증권을 불러올 때만 `start-relay.bat`을 켜 두면 돼요. 창을 닫으면 꺼져요.
- 휴대폰에서는 직접 못 불러와요. 집 PC에서 불러오면 동기화로 휴대폰에도 보여요.
- PC를 켤 때마다 자동으로 켜고 싶으면: `Win + R` → `shell:startup` 입력 → 열린 폴더에 `start-relay.bat`의 **바로 가기**를 넣어요.

## 잘 안 될 때

| 화면에 나온 말 | 이렇게 해 보세요 |
|---|---|
| 집 PC에서 토스 중계 프로그램을 켜 주세요 | 검은 창이 켜져 있는지, **같은 PC**의 브라우저에서 열었는지 확인해요. 브라우저 주소창 왼쪽 아이콘 → 사이트 설정에서 '로컬 네트워크 액세스'가 차단돼 있으면 허용으로 바꿔요. |
| 토스에 지금 PC의 IP를 등록해 주세요 | 공유기를 다시 켜거나 인터넷 회사가 바꾸면 IP가 달라져요. 검은 창에 나온 새 IP를 허용 IP 관리에 다시 넣어요. |
| Client ID나 Client Secret이 맞지 않아요 | 토스증권 Open API 화면의 **복사 버튼**으로 다시 붙여 넣어요 (앞뒤 빈칸 없이). |
| 이미 토스 중계 프로그램이 켜져 있어요 | 검은 창이 두 개 떠 있으면 하나만 남겨요. |
| Node.js가 설치되어 있지 않아요 | 1번을 하고 PC를 한 번 다시 켠 뒤 더블클릭해요. |

## 참고 (개발자용)

- 실행: `node relay.mjs` (Node 18 이상, 외부 패키지 없음). 테스트: `node --test relay.test.mjs`
- 토스로 넘기는 요청: `POST /oauth2/token`, `GET /api/v1/accounts`, `/api/v1/holdings`, `/api/v1/transactions`, `/api/v1/prices`, `/api/v1/exchange-rate`. 나머지는 403.
- 받는 출처(Origin): `https://converseddululu.github.io`, `null`(내려받은 HTML). Host가 `127.0.0.1`/`localhost`가 아니면 403. Chrome 사설 네트워크 접근(PNA) 사전 요청에 응답해요.
- `GET /health` → `{ ok: true, service: 'moa-toss-relay', version: 1, ip }`
- 토스에는 IPv4로만 연결해요. 시작할 때 공인 IPv4를 알려 주려고 `https://api.ipify.org`에 한 번 물어봐요.
- 환경 변수: `TOSS_RELAY_PORT`(기본 8790), `TOSS_RELAY_ORIGINS`(쉼표로 출처 추가, 예: 개발용 `http://localhost:5173`), `TOSS_RELAY_NO_IP_LOOKUP=1`(IP 확인 끄기)
