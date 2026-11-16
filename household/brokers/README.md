# 증권사 연결 모듈 (모아 가계부)

가계부 본체(`household/index.html`)는 증권사를 직접 알지 못해요. 증권사마다 이 폴더에 **파일 하나**를 두고,
그 파일이 아래 약속대로 `window.MoaBrokers.register(...)`를 부르면 본체가 '증권사 연결' 화면, 보유 종목,
순자산, 해외주식 양도세 계산에 자동으로 붙여요.

| 파일 | 증권사 | 연결 방식 |
|---|---|---|
| `kis.js` | 한국투자증권 | Cloudflare 중계(`/kis/...`, 조회 전용 허용 목록)를 거쳐 호출 |
| `kiwoom.js` | 키움증권 | 브라우저에서 `https://api.kiwoom.com` 직접 호출 (CORS 허용, **등록한 IP에서만**) |
| `toss.js` | 토스증권 | 집 PC에서 돌리는 작은 중계 프로그램(`/toss-relay/`)을 거쳐 호출 (고정 IP 필요, 브라우저 직접 호출 불가) |

본체는 `https://converseddululu.github.io/moa-money/household/brokers/<id>.js`를 절대 주소로 불러와요
(GitHub Pages와 내려받은 HTML 둘 다에서 동작하게). 파일이 없거나 오류가 나도 본체는 그냥 그 증권사를 빼고 동작해요.

## 등록 약속

```js
window.MoaBrokers.register({
  id: 'kiwoom',                 // 파일 이름과 같게: kis | kiwoom | toss
  name: '키움증권',
  fields: [                     // '연결하기' 입력칸. 값은 이 기기 localStorage에만 저장 (동기화·백업 안 됨)
    { key: 'appkey', label: 'App Key' },
    { key: 'secretkey', label: 'Secret Key', secret: true },     // secret: true → type=password
    { key: 'account', label: '계좌번호 (선택)', placeholder: '예: 1234567890', optional: true }
  ],
  help: '<p>키 발급 안내 HTML (본체가 그대로 보여 줘요. 짧게)</p>',
  notes: '한 줄 주의사항 (예: 등록한 IP에서만 불러올 수 있어요)',

  // 필수. 보유 종목과 (가능하면) 해외주식 실현손익을 불러와요.
  async refresh(cfg, ctx) {
    // cfg: fields 값 + 연결 모듈이 저장해 둔 상태(토큰 등). 바꾼 뒤 ctx.saveCfg(cfg)로 저장.
    return {
      kr: [/* Holding */],          // 국내
      us: [/* Holding */],          // 해외(미국)
      realized: { 2026: [/* Realized */] },   // 연도별 해외주식 실현손익 (없으면 {} )
      warn: ['해외주식 서비스가 없어 해외 잔고를 건너뛰었어요']    // 사용자에게 보일 경고 (선택)
    };
  },

  // 선택. 본체가 직접 넣은 종목의 현재가를 물어볼 때 써요. 못 하면 생략.
  async quote(cfg, ctx, items /* [{ key, market: 'KR'|'US', code }] */) {
    return { /* key: { price: number, ex?: 'NAS'|'NYS'|'AMS' } */ };
  }
});
```

### Holding
```js
{ code: '005930', name: '삼성전자', market: 'KR' | 'US',
  qty: 10, avg: 61500,          // 평균 매입단가 (cur 통화)
  price: 81200,                 // 현재가 (cur 통화)
  cur: 'KRW' | 'USD',
  value: 812000,                // 평가금액 (cur 통화)
  pl: 197000 }                  // 평가손익 (cur 통화)
```
숫자는 모두 `Number`로 (증권사가 주는 문자열·부호·0채움은 모듈 안에서 정리).

### Realized (해외주식 매도 1건, 양도세 계산용)
```js
{ date: '2026-03-05', code: 'NVDA', name: '엔비디아', qty: 20,
  gain: 1947840,                // 원화 양도차익 (수수료·제비용 반영 후). 양도세 계산에 그대로 써요
  proceeds: 5296900,            // 원화 양도가액 (모르면 null)
  basis: 3349060,               // 원화 취득가액 (모르면 null)
  exrt: 1452.1 }                // 적용 환율 (모르면 null)
```
증권사가 원화 실현손익을 직접 주면 그 값을 쓰고, 안 주면 거래내역(환율 포함)으로 계산해도 돼요.
계산 방식(이동평균·선입선출)을 `warn`에 한 줄로 알려 주세요.

### ctx (본체가 넘겨줌)
```js
{
  relay: 'https://moa-sync.moa-sync.workers.dev/',  // Cloudflare 중계 (kis만 사용)
  fx: 1337.13,                  // 현재 원/달러 환율
  today: () => 'YYYY-MM-DD',
  saveCfg: cfg => {},           // 토큰 같은 상태를 이 기기에 저장
  progress: text => {}          // '해외 잔고 불러오는 중…' 같은 진행 문구
}
```

## 지켜야 할 것
- **조회만.** 주문·취소·이체 API는 부르지 않아요.
- **키·토큰은 이 기기에만.** `ctx.saveCfg`로만 저장하고, 다른 서버로 보내지 않아요 (증권사와, kis의 경우 조회 전용 중계만).
- 오류는 `throw new Error('사용자에게 보여 줄 한국어 문장')`. 예: IP가 안 맞으면 "키움에 등록한 IP(집 와이파이)에서 열어 주세요".
- 토큰은 수명 동안 재사용해요 (발급 횟수 제한·알림이 있는 증권사가 있어요).
- 외부 라이브러리 없이 순수 JS 한 파일. 전역은 `MoaBrokers.register` 한 번만.
