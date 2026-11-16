// 토스증권 샘플 응답 (시뮬레이션용, 지어낸 예시 숫자 — 종목 이름만 실제). 네트워크를 쓰지 않아요.
// 본체가 '샘플로 해 보기'를 누르면 fetch를 잠깐 이 함수로 돌려서, 진짜 toss.js를 그대로 실행해요.
// 응답은 집 PC 중계(toss-relay/relay.mjs) + 토스증권 Open API(openapi.json v1.2.28)와 같은 모양이에요:
// 성공은 { result: ... }, 금액은 소수 문자열, 오류는 { error: { code, message } } (토큰 발급만 OAuth2 모양).
// 중계 주소(127.0.0.1:8790 / localhost:8790)가 아닌 요청은 null을 돌려줘서 본체가 그대로 넘기게 해요.
(function () {
  window.MoaBrokerSim = window.MoaBrokerSim || {};
  const RELAY_ORIGINS = ['http://127.0.0.1:8790', 'http://localhost:8790'];
  const ACCOUNT_SEQ = 1;
  const TOKEN_PREFIX = 'sim-';
  const PAGE = 10; // 쪽 넘기기(nextCursor)가 한 번은 일어나게 작게 잡아요
  let seq = 0, tokenN = 0;

  // ---------- 응답 모양 ----------
  const rid = () => 'SIM' + String(Date.now()).slice(-8) + String(++seq).padStart(4, '0');
  const send = (status, body, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'x-request-id': rid(), 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '4', ...headers }
  });
  const ok = result => send(200, { result });
  const err = (status, code, message, data) => send(status, { error: { requestId: rid(), code, message, ...(data ? { data } : {}) } });
  const relayErr = (status, code, message) => new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

  // ---------- 날짜 (이 기기 날짜 기준) ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = t => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const kstNow = () => {
    const t = new Date(Date.now() + 9 * 3600e3);
    return t.toISOString().replace('Z', '+09:00');
  };

  // ---------- 숫자 문자열 ----------
  const usd = cents => (cents / 100).toFixed(2);           // 정수 센트 → "123.45"
  const krw = won => String(Math.round(won));
  const rate4 = x => (isFinite(x) ? x : 0).toFixed(4);
  const FX = 1337; // 요약 손익률 계산용 매매기준율

  // ---------- 보유 주식 (원화는 원, 달러는 센트로 적어요) ----------
  // [심볼, 이름, 시장, 수량, 평균단가, 현재가, 전일종가, 증권거래세 대상?]
  const HOLD = [
    ['005930', '삼성전자', 'KR', 30, 61200, 71800, 70900, true],
    ['035420', 'NAVER', 'KR', 5, 198500, 186000, 188500, true],
    ['360750', 'TIGER 미국S&P500', 'KR', 120, 17450, 21385, 21240, false],
    ['NVDA', '엔비디아', 'US', 8, 9347, 18120, 17835, false],
    ['TSLA', '테슬라', 'US', 4, 18020, 23850, 24110, false],
    ['SCHD', '슈왑 미국 배당주 ETF', 'US', 30, 2610, 2745, 2738, false]
  ];
  const holdingItem = ([symbol, name, mc, q, avg, last, prev, taxed]) => {
    const isUs = mc === 'US', fmt = isUs ? usd : krw;
    const purchase = q * avg, amount = q * last;
    const commission = isUs ? Math.round(amount * 0.001) : Math.round(amount * 0.00015);
    const tax = isUs || !taxed ? null : Math.round(amount * 0.0018);
    const after = amount - commission - (tax || 0);
    return {
      symbol, name, marketCountry: mc, currency: isUs ? 'USD' : 'KRW',
      quantity: String(q), lastPrice: fmt(last), averagePurchasePrice: fmt(avg),
      marketValue: { purchaseAmount: fmt(purchase), amount: fmt(amount), amountAfterCost: fmt(after) },
      profitLoss: { amount: fmt(amount - purchase), amountAfterCost: fmt(after - purchase), rate: rate4((amount - purchase) / purchase), rateAfterCost: rate4((after - purchase) / purchase) },
      dailyProfitLoss: { amount: fmt(q * (last - prev)), rate: rate4((last - prev) / prev) },
      cost: { commission: fmt(commission), tax: tax == null ? null : fmt(tax) },
      _n: { isUs, purchase, amount, after, daily: q * (last - prev) }
    };
  };
  function holdings(symbol) {
    const all = HOLD.map(holdingItem).filter(it => !symbol || it.symbol === symbol);
    const sum = (k, us) => all.filter(it => it._n.isUs === us).reduce((s, it) => s + it._n[k], 0);
    const hasUs = all.some(it => it._n.isUs);
    const price = k => ({ krw: krw(sum(k, false)), usd: hasUs ? usd(sum(k, true)) : null });
    const inKrw = k => sum(k, false) + sum(k, true) / 100 * FX;
    const plAll = inKrw('amount') - inKrw('purchase'), plAfter = inKrw('after') - inKrw('purchase'), daily = inKrw('daily');
    return {
      totalPurchaseAmount: price('purchase'),
      marketValue: { amount: price('amount'), amountAfterCost: price('after') },
      profitLoss: {
        amount: { krw: krw(sum('amount', false) - sum('purchase', false)), usd: hasUs ? usd(sum('amount', true) - sum('purchase', true)) : null },
        amountAfterCost: { krw: krw(sum('after', false) - sum('purchase', false)), usd: hasUs ? usd(sum('after', true) - sum('purchase', true)) : null },
        rate: rate4(plAll / inKrw('purchase')), rateAfterCost: rate4(plAfter / inKrw('purchase'))
      },
      dailyProfitLoss: { amount: price('daily'), rate: rate4(daily / (inKrw('amount') - daily)) },
      items: all.map(({ _n, ...it }) => it)
    };
  }

  // ---------- 거래내역 (작년 + 올해, 매수·매도) ----------
  // 미국 실현손익: 작년 AAPL 이익, 올해 NVDA 이익·TSLA 손실. 미결제 1건(SCHD)과 국내 취소 1건(카카오)은 계산에서 빠져요.
  function transactionsAll() {
    const now = new Date(), Y = now.getFullYear(), L = Y - 1;
    const jan1 = new Date(Y, 0, 1), elapsed = Math.floor((new Date(Y, now.getMonth(), now.getDate()) - jan1) / 86400e3);
    const d = f => ymd(new Date(Y, 0, 1 + Math.floor(elapsed * f))); // 올해 1월 1일 ~ 오늘 사이
    const t1 = new Date(now); t1.setDate(t1.getDate() + 1);
    // [유형, 시장, 심볼, 결제일, 수량, 체결단가, 거래금액, 수수료, 세금, 정산금액, 환율, 덧붙일 값]
    const R = [
      ['BUY', 'KR', '005930', `${L}-01-23`, '30', '61200', '1836000', '275', '0', '1836275', null],
      ['BUY', 'US', 'NVDA', `${L}-02-14`, '10', '72.50', '725.00', '0.73', '0', '725.73', '1325.40'],
      ['BUY', 'US', 'TSLA', `${L}-05-20`, '6', '180.20', '1081.20', '1.08', '0', '1082.28', '1368.10'],
      ['BUY', 'US', 'SCHD', `${L}-07-03`, '40', '26.10', '1044.00', '1.04', '0', '1045.04', '1381.20'],
      ['BUY', 'KR', '035420', `${L}-08-12`, '8', '198500', '1588000', '238', '0', '1588238', null],
      ['BUY', 'US', 'AAPL', `${L}-09-11`, '8', '175.00', '1400.00', '1.40', '0', '1401.40', '1335.80'],
      ['SELL', 'US', 'AAPL', `${L}-11-18`, '8', '205.30', '1642.40', '1.64', '0.04', '1640.72', '1398.60'],
      ['BUY', 'US', 'NVDA', d(0.12), '5', '135.40', '677.00', '0.68', '0', '677.68', '1452.30'],
      ['BUY', 'KR', '360750', d(0.25), '120', '17450', '2094000', '314', '0', '2094314', null],
      ['BUY', 'KR', '035720', d(0.33), '10', '41250', '412500', '61', '0', '412561', null, { isCancellation: true }],
      ['SELL', 'US', 'NVDA', d(0.45), '7', '168.90', '1182.30', '1.18', '0.03', '1181.09', '1471.20'],
      ['SELL', 'KR', '035420', d(0.6), '3', '214000', '642000', '96', '1155', '640749', null],
      ['SELL', 'US', 'TSLA', d(0.75), '2', '152.40', '304.80', '0.30', '0.01', '304.49', '1440.50'],
      ['SELL', 'US', 'SCHD', ymd(t1), '10', null, '274.50', '0.27', '0.01', '274.22', null, { settled: false }]
    ];
    const rows = R.map(([type, mc, symbol, date, quantity, filledPrice, amount, commission, tax, netAmount, exchangeRate, extra], i) => {
      const settled = !(extra && extra.settled === false);
      return {
        transactionType: type, marketCountry: mc, currency: mc === 'US' ? 'USD' : 'KRW', symbol, assetClass: 'STOCK', isinCode: null,
        quantity, filledPrice: settled ? filledPrice : null, amount, commission, tax, netAmount,
        exchangeRate: settled ? exchangeRate : null, settlementDate: date, settled,
        transactionTime: settled ? `${date}T${mc === 'US' ? '06' : '08'}:${pad(10 + i)}:00+09:00` : null,
        isCancellation: false, ...(extra || {})
      };
    });
    // API 순서: 미결제 먼저, 그다음 결제 완료를 처리시각 최신순으로
    const open = rows.filter(r => !r.settled), done = rows.filter(r => r.settled);
    done.sort((a, b) => (a.transactionTime < b.transactionTime ? 1 : a.transactionTime > b.transactionTime ? -1 : 0));
    return [...open, ...done];
  }

  const TX_TYPES = ['BUY', 'SELL', 'SECURITIES_TRANSFER_IN', 'SECURITIES_TRANSFER_OUT', 'DEPOSIT', 'WITHDRAWAL', 'EXCHANGE_IN', 'EXCHANGE_OUT', 'DIVIDEND', 'INTEREST', 'FEE'];
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  function transactions(q) {
    const types = q.get('transactionTypes');
    let want = null;
    if (types) {
      want = types.split(',');
      if (want.some(t => !TX_TYPES.includes(t))) return err(400, 'invalid-request', '요청이 올바르지 않습니다.', { field: 'transactionTypes', allowedValues: TX_TYPES });
    }
    const from = q.get('from'), to = q.get('to');
    if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) return err(400, 'invalid-request', '요청 필드가 올바르지 않습니다.');
    const limit = q.has('limit') ? Number(q.get('limit')) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return err(400, 'invalid-request', '요청 필드가 올바르지 않습니다.', { field: 'limit', rule: 'Max', max: 100 });
    const cursor = q.get('cursor');
    let start = 0;
    if (cursor) {
      const m = /^SIMp(\d+)$/.exec(cursor);
      if (!m) return err(400, 'invalid-request', '요청 필드가 올바르지 않습니다.', { field: 'cursor', rule: 'Pattern', pattern: '^[A-Za-z0-9_\\-]+$' });
      start = Number(m[1]);
    }
    const list = transactionsAll().filter(r => (!want || want.includes(r.transactionType)) && (!from || r.settlementDate >= from) && (!to || r.settlementDate <= to));
    const size = Math.min(limit, PAGE), page = list.slice(start, start + size), hasNext = start + size < list.length;
    return ok({ transactions: page, nextCursor: hasNext ? `SIMp${start + size}` : null, hasNext });
  }

  // ---------- 현재가 (보유 종목은 같은 값, 나머지는 심볼로 정해지는 가짜 값) ----------
  const isKrCode = s => /^[0-9][0-9A-Z]{5}$/.test(s);
  function priceOf(sym) {
    const h = HOLD.find(x => x[0] === sym);
    if (h) return h[2] === 'US' ? { lastPrice: usd(h[5]), currency: 'USD' } : { lastPrice: krw(h[5]), currency: 'KRW' };
    let n = 7;
    for (const c of sym) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return isKrCode(sym) ? { lastPrice: krw(5000 + (n % 1950) * 100), currency: 'KRW' } : { lastPrice: usd(1000 + (n % 49000)), currency: 'USD' };
  }
  function prices(q) {
    const raw = q.get('symbols') || '';
    const syms = raw ? raw.split(',') : [];
    if (!syms.length || syms.length > 200 || syms.some(s => !/^[A-Za-z0-9.\-]+$/.test(s)))
      return err(400, 'invalid-request', '요청이 올바르지 않습니다.', { field: 'symbols', constraint: { min: 1, max: 200 } });
    const ts = kstNow();
    return ok([...new Set(syms)].map(symbol => ({ symbol, timestamp: ts, ...priceOf(symbol) })));
  }

  // ---------- 환율 ----------
  function exchangeRate(q) {
    const b = q.get('baseCurrency'), c = q.get('quoteCurrency');
    if (!['USD', 'KRW'].includes(b) || !['USD', 'KRW'].includes(c)) return err(400, 'invalid-request', '지원하지 않는 통화입니다.', { field: 'baseCurrency', allowedValues: ['KRW', 'USD'] });
    if (b === c) return err(400, 'invalid-request', '기준 통화와 상대 통화가 같을 수 없습니다.', { field: 'baseCurrency,quoteCurrency' });
    const mid = b === 'USD' ? 1337 : 1 / 1337, rate = b === 'USD' ? 1342.35 : 1 / 1331.65;
    const t = new Date(Date.now() + 9 * 3600e3); t.setUTCSeconds(0, 0);
    const iso = x => x.toISOString().slice(0, 19) + '+09:00';
    return ok({
      baseCurrency: b, quoteCurrency: c, rate: b === 'USD' ? rate.toFixed(2) : rate.toFixed(8), midRate: b === 'USD' ? mid.toFixed(2) : mid.toFixed(8),
      basisPoint: ((rate - mid) / mid * 10000).toFixed(2), rateChangeType: 'UP', validFrom: iso(t), validUntil: iso(new Date(t.getTime() + 60e3))
    });
  }

  // ---------- 라우터 ----------
  const ROUTES = ['POST /oauth2/token', 'GET /api/v1/accounts', 'GET /api/v1/holdings', 'GET /api/v1/transactions', 'GET /api/v1/prices', 'GET /api/v1/exchange-rate'];

  window.MoaBrokerSim.toss = async function (url, init) {
    let u;
    try { u = new URL(typeof url === 'string' ? url : (url && url.url) || String(url)); } catch (e) { return null; }
    if (!RELAY_ORIGINS.includes(u.origin)) return null;
    const req = url && typeof url === 'object' && url.url ? url : null;
    const method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
    const headers = new Headers((init && init.headers) || (req && req.headers) || {});
    const p = u.pathname, q = u.searchParams;
    await new Promise(r => setTimeout(r, 30)); // 진짜처럼 아주 잠깐 기다려요

    // 중계 프로그램 자체
    if (method === 'GET' && p === '/health') return new Response(JSON.stringify({ ok: true, service: 'moa-toss-relay', version: 1, ip: '203.0.113.7' }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    if (!ROUTES.includes(`${method} ${p}`)) return relayErr(403, 'relay-forbidden-path', '토스 중계 프로그램은 조회만 넘겨요');

    // 토큰 발급 (OAuth2 표준 모양)
    if (p === '/oauth2/token') {
      const body = init && init.body != null ? String(init.body) : '';
      const f = new URLSearchParams(body);
      if (!/application\/x-www-form-urlencoded/i.test(headers.get('content-type') || '')) return send(400, { error: 'invalid_request', error_description: 'OAuth 2.0 Parameter: grant_type' });
      if (f.get('grant_type') !== 'client_credentials') return send(400, { error: 'unsupported_grant_type', error_description: 'OAuth 2.0 Parameter: grant_type' });
      for (const k of ['client_id', 'client_secret']) if (!f.get(k)) return send(400, { error: 'invalid_request', error_description: `OAuth 2.0 Parameter: ${k}` });
      return send(200, { access_token: `${TOKEN_PREFIX}${++tokenN}.SAMPLE-ACCESS-TOKEN`, token_type: 'Bearer', expires_in: 86400 });
    }

    // 나머지는 토큰이 필요해요. 샘플에서 발급한 토큰이면 모두 받아 줘요 (여러 화면이 동시에 불러도 서로 무효로 만들지 않게).
    const auth = headers.get('authorization');
    if (!auth) return err(401, 'edge-blocked', 'Authorization 헤더가 전달되지 않았습니다.');
    if (!auth.startsWith('Bearer ' + TOKEN_PREFIX)) return err(401, 'invalid-token', '유효하지 않은 토큰입니다.');

    if (p === '/api/v1/accounts') return ok([{ accountNo: '12345678901', accountSeq: ACCOUNT_SEQ, accountType: 'BROKERAGE' }]);
    if (p === '/api/v1/prices') return prices(q);
    if (p === '/api/v1/exchange-rate') return exchangeRate(q);

    // 계좌 헤더가 필요한 조회
    const acc = headers.get('x-tossinvest-account');
    if (!acc) return err(400, 'account-header-required', 'x-tossinvest-account 헤더가 필요합니다.');
    if (acc !== String(ACCOUNT_SEQ)) return err(404, 'account-not-found', '계좌를 찾을 수 없습니다.');
    if (p === '/api/v1/holdings') {
      const s = q.get('symbol');
      if (s && !/^[A-Za-z0-9.\-]+$/.test(s)) return err(400, 'invalid-request', '요청이 올바르지 않습니다.');
      return ok(holdings(s));
    }
    return transactions(q);
  };
})();
