# 알림 받은편지함 (모아 가계부 '알림 자동 받기')

휴대폰 자동화(안드로이드 MacroDroid, 아이폰 단축어)가 카드·은행 문자/알림을 **받는 즉시** 이 주소로 보내면,
서버는 그 내용을 **가계부만 열 수 있게 암호화해서** 잠깐 보관하고, 가계부가 가져가면 지워요.

- 기본 주소: `https://moa-sync.moa-sync.workers.dev`
- `{id}`: 22–64자 `[A-Za-z0-9_-]` (가계부가 무작위로 만듦)
- 주인 토큰 `X-Owner-Token`: 가계부가 무작위로 만든 문자열(20자 이상). 서버는 SHA-256 해시만 저장해요.
- 받은편지함 하나 = Durable Object(`Inbox`, SQLite 저장) 하나. 같은 순간에 알림 두 개가 와도 잃지 않아야 해요.

## 암호화 (ECDH P-256 + AES-GCM, WebCrypto 표준)
- 가계부가 ECDH P-256 키쌍을 만들고 **공개키(JWK)** 만 서버에 등록해요. 비밀키는 가계부(기기·암호화 동기화)에만 있어요.
- 알림이 오면 서버가 **메시지마다 임시 키쌍**을 만들고
  `deriveKey({name:'ECDH', public: 등록된 공개키}, 임시비밀키, {name:'AES-GCM', length:256})`로 키를 만든 뒤
  12바이트 무작위 `iv`로 **UTF-8 원문**을 암호화해 저장해요. 원문은 저장하지 않아요.
- 저장 형식: `{ id, at: ISO시각, epk: 임시공개키 raw(65바이트 비압축) base64, iv: base64, ct: base64 }` (base64는 표준, = 패딩 포함)
- 가계부는 `deriveKey({name:'ECDH', public: epk}, 비밀키, AES-GCM 256)`로 같은 키를 만들어 풀어요.

## API (모든 응답 JSON, CORS `*`, 허용 헤더 `Content-Type, X-Owner-Token`, 메서드 `GET, POST, PUT, DELETE, OPTIONS`)

| 요청 | 누가 | 설명 | 응답 |
|---|---|---|---|
| `PUT /inbox/{id}/key` + `X-Owner-Token` + 본문 `{ "pub": <ECDH P-256 공개키 JWK> }` | 가계부 | 받은편지함 만들기(처음 토큰 해시 저장) 또는 키 교체(같은 토큰일 때만) | `200 {ok:true}` · 다른 토큰이면 `403` · 잘못된 키면 `400` |
| `POST /in/{id}` | 휴대폰 자동화 | 알림 하나 넣기. 본문은 ① `text/plain` 원문, ② JSON `{text|message|body|content: "..."}` (`title`이 같이 오면 `title + " " + text`), ③ form `text=...` 중 아무거나. 앞뒤 공백 정리 | `200 {ok:true}` · 등록 안 된 id `404` · 빈 본문 `400` · 4000자 넘음 `413` · 쌓인 게 300개 넘음 `429` |
| `GET /inbox/{id}` + `X-Owner-Token` | 가계부 | 쌓인 알림 목록(오래된 순, 최대 300) | `200 {items:[{id,at,epk,iv,ct}]}` · 토큰 틀림/없는 id `403`/`404` |
| `POST /inbox/{id}/ack` + `X-Owner-Token` + 본문 `{ "ids": ["..."] }` | 가계부 | 처리한 알림 지우기 | `200 {ok:true, deleted:n}` |
| `DELETE /inbox/{id}` + `X-Owner-Token` | 가계부 | 받은편지함 통째로 지우기(끄기) | `200 {ok:true}` |

- 알림은 **7일 뒤 자동 삭제**(Durable Object alarm).
- 기존 경로(`/v1/...` 동기화, `/kis/...` 한국투자 중계)는 그대로 동작해야 해요.
- 로그에 본문·토큰을 남기지 않아요.
