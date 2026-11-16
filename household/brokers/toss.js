// 토스증권 연결 모듈 (조회 전용)
// 토스증권 Open API는 '허용 IP'로 등록한 곳에서만 받아 주고 CORS 헤더가 없어서 브라우저에서 바로 부를 수 없어요.
// 그래서 집 PC에서 작은 중계 프로그램(toss-relay/relay.mjs)을 켜 두고, 그 PC 브라우저에서 http://127.0.0.1:8790 으로 불러요.
// 중계는 조회 6가지만 통과시키고 아무것도 저장하지 않아요. 키·토큰은 이 기기에만(ctx.saveCfg) 있어요.
// 경로·필드 이름은 토스증권 공식 openapi.json(v1.2.28)에서 확인했어요.
(function () {
  if (!window.MoaBrokers) return;
  const DEFAULT_RELAY = 'http://127.0.0.1:8790';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = v => { const x = Number(String(v ?? '').replace(/,/g, '').trim()); return isFinite(x) ? x : 0; };
  const say = (ctx, t) => { try { if (ctx && ctx.progress) ctx.progress(t); } catch (e) { /* 진행 문구는 실패해도 괜찮아요 */ } };
  // 오류: fatal이면 다시 눌러도 안 되는 문제(중계 꺼짐·IP·키)라 현재가 조회에서도 바로 알려요.
  const mk = (msg, fatal, status, code) => Object.assign(new Error(msg), { fatal: !!fatal, status, code });

  const RELAY_OFF = '집 PC에서 토스 중계 프로그램을 켜 주세요 (toss-relay 폴더의 start-relay.bat). 켜져 있다면 그 PC의 브라우저에서 열고, 브라우저가 로컬 네트워크 접근을 물으면 허용해 주세요';

  // 토스 요청 한도(초당): 토큰 5, 계좌 1, 보유 주식·거래내역 5, 시세 15, 환율 3. 조금 여유 있게 간격을 둬요.
  const GAP = { AUTH: 250, ACCOUNT: 1100, ASSET: 250, TRANSACTION: 250, MARKET_DATA: 80, MARKET_INFO: 400 };
  const lastAt = {};
  async function pace(group) {
    const wait = (lastAt[group] || 0) + (GAP[group] || 250) - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt[group] = Date.now();
  }

  async function hit(url, init, ms) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), ms) : 0;
    try { return await fetch(url, { ...init, cache: 'no-store', signal: ac ? ac.signal : undefined }); }
    catch (e) {
      if (ac && ac.signal.aborted) throw mk('토스 서버가 너무 늦게 답해요. 조금 뒤에 다시 눌러 주세요');
      throw mk(RELAY_OFF, true);
    } finally { if (t) clearTimeout(t); }
  }

  // 중계 프로그램이 켜져 있는지 먼저 확인해요. /health는 이 PC의 공인 IP도 알려 줘요 (IP 등록 안내에 써요).
  async function connect(cfg) {
    let base = String(cfg.relay || '').trim() || DEFAULT_RELAY;
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
    base = base.replace(/\/+$/, '');
    const r = await hit(base + '/health', {}, 5000);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.service !== 'moa-toss-relay') throw mk(`${base}에서 토스 중계 프로그램을 찾지 못했어요. 주소를 확인하거나 start-relay.bat을 다시 켜 주세요`, true);
    return { base, ip: j.ip || null };
  }

  const creds = cfg => {
    const id = String(cfg.client_id || '').trim(), secret = String(cfg.client_secret || '').trim();
    if (!id || !secret) throw mk('토스증권 Client ID와 Client Secret을 넣어 주세요', true);
    return { id, secret };
  };

  function tossErr(status, code, msg, st) {
    if (status === 403 && (code === 'ip-not-allowed' || code === 'access_denied'))
      return mk(`토스에 지금 PC의 IP${st.ip ? `(${st.ip})` : ''}를 등록해 주세요. 토스증권 PC 웹 → 설정 → Open API → 허용 IP 관리에서 넣을 수 있어요`, true, status, code);
    if (code === 'invalid_client') return mk('Client ID나 Client Secret이 맞지 않아요. 토스증권 PC 웹 → 설정 → Open API의 복사 버튼으로 다시 붙여 넣어 주세요', true, status, code);
    if (code === 'invalid_request') return mk('Client ID와 Client Secret을 다시 확인해 주세요 (앞뒤 빈칸 없이)', true, status, code);
    if (code === 'login-user-not-found') return mk('토스 로그인 정보를 찾지 못했어요. 토스증권 Open API 화면에서 키가 살아 있는지 확인해 주세요', true, status, code);
    if (status === 401) return mk('토스 로그인이 풀렸어요. 한 번 더 눌러 주세요', false, status, code);
    if (code === 'relay-upstream-unreachable') return mk('중계 프로그램이 토스 서버에 닿지 못했어요. 집 PC의 인터넷 연결을 확인해 주세요', true, status, code);
    if (status === 429) return mk('토스에 요청이 잠깐 많았어요. 1분쯤 뒤에 다시 눌러 주세요', false, status, code);
    if (status === 504 || code === 'relay-upstream-timeout') return mk('토스 서버가 너무 늦게 답해요. 조금 뒤에 다시 눌러 주세요', false, status, code);
    if (status >= 500) return mk('토스 서버가 잠시 답하지 않아요. 조금 뒤에 다시 눌러 주세요', false, status, code);
    if (status === 403) return mk(msg ? `토스: ${String(msg).trim()}` : `토스가 이 요청을 막았어요 (${code || status})`, true, status, code);
    return mk(msg ? `토스: ${String(msg).trim()}` : `토스에서 오류가 났어요 (${code || status})`, false, status, code);
  }

  // 토스 응답은 { result: ... }로 감싸져 와요 (토큰 발급만 OAuth2 표준 모양).
  async function call(cfg, ctx, st, method, path, o = {}) {
    let renewed = false;
    for (let tries = 0; ; tries++) {
      await pace(o.group);
      const headers = {};
      if (o.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (!o.noAuth) headers.Authorization = 'Bearer ' + await token(cfg, ctx, st);
      if (o.account != null) headers['X-Tossinvest-Account'] = String(o.account);
      const body = o.form ? Object.entries(o.form).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : undefined;
      const r = await hit(st.base + path, { method, headers, body }, 30000);
      const text = await r.text().catch(() => '');
      let j = null;
      try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
      if (r.ok && j) return j.result !== undefined ? j.result : j;
      const e = j && j.error;
      const code = typeof e === 'string' ? e : (e && e.code) || '';
      const msg = typeof e === 'string' ? j.error_description : e && e.message;
      if (r.status === 429 && tries < 3) {
        const s = Math.min(Math.max(num(r.headers.get('Retry-After')) || tries + 1, 1), 10);
        say(ctx, `토스 요청이 많아서 ${Math.ceil(s)}초 기다리는 중…`);
        await sleep(s * 1000);
        continue;
      }
      // 토큰은 클라이언트당 1개라, 다른 곳에서 새로 받으면 이전 것이 무효(token-revoked)가 돼요. 한 번만 새로 받아요.
      if (r.status === 401 && !o.noAuth && !renewed && /^(expired-token|invalid-token|token-revoked)$/.test(code)) {
        renewed = true; cfg.token = null; ctx.saveCfg(cfg);
        continue;
      }
      throw tossErr(r.status, code, msg, st);
    }
  }

  // 토큰은 보통 24시간 유효해요. 새로 받으면 이전 토큰이 바로 무효가 돼서 끝나기 직전까지 재사용해요.
  async function token(cfg, ctx, st) {
    const { id, secret } = creds(cfg);
    if (cfg.token && cfg.tokenClient === id && num(cfg.tokenExp) > Date.now() + 5 * 60 * 1000) return cfg.token;
    say(ctx, '토스증권 로그인 중…');
    const j = await call(cfg, ctx, st, 'POST', '/oauth2/token', {
      noAuth: true, group: 'AUTH', form: { grant_type: 'client_credentials', client_id: id, client_secret: secret }
    });
    if (!j || !j.access_token) throw mk('토스 로그인 응답을 이해하지 못했어요. 조금 뒤에 다시 눌러 주세요');
    cfg.token = j.access_token;
    cfg.tokenExp = Date.now() + (num(j.expires_in) || 3600) * 1000;
    cfg.tokenClient = id;
    ctx.saveCfg(cfg);
    return cfg.token;
  }

  // 거래내역(매수·매도)을 처음부터 끝까지 받아요. 이동평균 취득가를 맞추려면 예전 매수 기록도 필요해요.
  async function trades(cfg, ctx, st, seq, warn) {
    const rows = [], seen = new Set();
    let cursor = null;
    for (let page = 0; ; page++) {
      if (page >= 300) { warn.push('토스 거래내역이 너무 많아 앞쪽 30,000건까지만 계산했어요'); break; }
      const q = 'transactionTypes=BUY,SELL&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const r = await call(cfg, ctx, st, 'GET', '/api/v1/transactions?' + q, { account: seq, group: 'TRANSACTION' });
      rows.push(...((r && Array.isArray(r.transactions)) ? r.transactions : []));
      say(ctx, `토스 거래내역 불러오는 중… (${rows.length}건)`);
      if (!r || !r.hasNext || !r.nextCursor || seen.has(r.nextCursor)) break;
      seen.add(r.nextCursor);
      cursor = r.nextCursor;
    }
    return rows;
  }

  const isUsStockTrade = t => t && (t.transactionType === 'BUY' || t.transactionType === 'SELL') && t.marketCountry === 'US'
    && (t.assetClass == null || t.assetClass === 'STOCK') && t.symbol && t.settled === true && !t.isCancellation && num(t.quantity) > 0;
  const cmp = (a, b) => (a || '') < (b || '') ? -1 : (a || '') > (b || '') ? 1 : 0;

  // 미국 주식 실현손익(원화): 결제된 매매만, 결제일 순서로 이동평균 취득가를 따라가요.
  // 매수 원가 = 정산금액(netAmount, 수수료·세금 포함) × 그 거래 환율, 매도 차익 = 정산금액(수수료·세금 뺀 값) × 그 거래 환율 − 평균 원가.
  // 취소 내역(isCancellation)은 원거래가 목록에서 빠지므로 같이 건너뛰어요.
  function realizedOf(rows, years, names, fx) {
    const list = rows.map((t, i) => [t, i]).filter(([t]) => isUsStockTrade(t))
      .sort(([a, i], [b, j]) => cmp(a.settlementDate, b.settlementDate) || cmp(a.transactionTime, b.transactionTime) || j - i);
    const pos = {}, out = {}, short = [];
    let guessed = 0;
    for (const y of years) out[y] = [];
    for (const [t] of list) {
      const code = String(t.symbol).trim().toUpperCase(), q = num(t.quantity);
      let rate = num(t.exchangeRate);
      if (!(rate > 0)) { rate = fx; guessed++; }
      const p = pos[code] || (pos[code] = { qty: 0, cost: 0 });
      if (t.transactionType === 'BUY') {
        const usd = t.netAmount != null ? num(t.netAmount) : num(t.amount) + num(t.commission) + num(t.tax);
        p.qty += q; p.cost += usd * rate;
        continue;
      }
      const gross = num(t.amount);
      const net = t.netAmount != null ? num(t.netAmount) : gross - num(t.commission) - num(t.tax);
      const cov = Math.min(q, p.qty), part = cov / q, basis = p.qty > 0 ? p.cost * (cov / p.qty) : 0;
      p.qty -= cov; p.cost -= basis;
      if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
      const y = Number(String(t.settlementDate).slice(0, 4));
      if (!out[y]) continue;
      if (q - cov > 1e-9) short.push(`${code} ${t.settlementDate} ${+(q - cov).toFixed(6)}주`);
      if (cov > 1e-9) out[y].push({
        date: t.settlementDate, code, name: names[code] || code, qty: +cov.toFixed(8),
        gain: Math.round(net * part * rate - basis), proceeds: Math.round(gross * part * rate), basis: Math.round(basis), exrt: rate || null
      });
    }
    return { out, short, guessed };
  }

  async function refresh(cfg, ctx) {
    creds(cfg);
    const st = await connect(cfg), warn = [];
    say(ctx, '토스증권 계좌 확인 중…');
    const acc = await call(cfg, ctx, st, 'GET', '/api/v1/accounts', { group: 'ACCOUNT' });
    const accounts = (Array.isArray(acc) ? acc : []).filter(a => a && a.accountSeq != null);
    if (!accounts.length) return { kr: [], us: [], realized: {}, warn: ['토스증권 종합매매 계좌를 찾지 못했어요'] };

    // 보유 주식: 계좌가 여러 개면 같은 종목을 합쳐요. 금액은 그 종목의 통화(KRW/USD) 기준이에요.
    const byKey = new Map(), names = {};
    for (const a of accounts) {
      say(ctx, '토스증권 보유 종목 불러오는 중…');
      const h = await call(cfg, ctx, st, 'GET', '/api/v1/holdings', { account: a.accountSeq, group: 'ASSET' });
      for (const it of (h && Array.isArray(h.items)) ? h.items : []) {
        const qty = num(it.quantity), code = String(it.symbol || '').trim();
        const market = it.marketCountry === 'US' ? 'US' : it.marketCountry === 'KR' ? 'KR' : null;
        if (!(qty > 0) || !code || !market) continue;
        names[code.toUpperCase()] = it.name || code;
        const mv = it.marketValue || {}, pl = it.profitLoss || {}, avg = num(it.averagePurchasePrice);
        const cost = num(mv.purchaseAmount) || qty * avg, k = market + ':' + code, o = byKey.get(k);
        if (!o) {
          byKey.set(k, {
            code, name: it.name || code, market, qty, avg, price: num(it.lastPrice),
            cur: it.currency === 'USD' || it.currency === 'KRW' ? it.currency : market === 'US' ? 'USD' : 'KRW',
            value: num(mv.amount), pl: num(pl.amount), cost
          });
        } else {
          o.qty += qty; o.cost += cost; o.avg = o.cost / o.qty; o.value += num(mv.amount); o.pl += num(pl.amount);
        }
      }
    }
    const all = [...byKey.values()].map(({ cost, ...h }) => h);
    const kr = all.filter(h => h.market === 'KR'), us = all.filter(h => h.market === 'US');

    // 해외주식 실현손익: 토스는 원화 실현손익을 따로 주지 않아서 거래내역으로 계산해요 (올해·작년).
    const today = typeof ctx.today === 'function' ? String(ctx.today()) : new Date().toISOString().slice(0, 10);
    const y0 = Number(today.slice(0, 4)), years = [y0, y0 - 1];
    let realized = {};
    try {
      const per = [];
      for (const a of accounts.filter(a => !a.accountType || a.accountType === 'BROKERAGE')) per.push(await trades(cfg, ctx, st, a.accountSeq, warn));
      let fx = num(ctx.fx);
      if (per.some(rows => rows.some(t => isUsStockTrade(t) && !(num(t.exchangeRate) > 0)))) {
        try {
          const x = await call(cfg, ctx, st, 'GET', '/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW', { group: 'MARKET_INFO' });
          fx = num(x && x.midRate) || fx;
        } catch (e) { /* 오늘 환율은 본체 값으로 대신해요 */ }
      }
      const short = [];
      let guessed = 0;
      for (const y of years) realized[y] = [];
      for (const rows of per) {
        const r = realizedOf(rows, years, names, fx);
        for (const y of years) realized[y].push(...r.out[y]);
        short.push(...r.short); guessed += r.guessed;
      }
      for (const y of years) realized[y].sort((a, b) => cmp(a.date, b.date));
      if (years.some(y => realized[y].length)) warn.push('토스 해외주식 실현손익은 거래내역으로 계산했어요: 이동평균법, 거래마다 그 결제 환율, 매수·매도 수수료와 세금 반영 (참고용)');
      if (short.length) warn.push(`토스에서 산 기록이 없는 매도 수량은 실현손익에서 뺐어요 (다른 증권사에서 옮겨 온 주식 등): ${short.join(', ')}. 이 부분은 직접 넣어 주세요`);
      if (guessed) warn.push(`환율이 비어 있는 해외 거래 ${guessed}건은 오늘 환율로 계산했어요`);
    } catch (e) {
      realized = {};
      warn.push(`토스 해외주식 실현손익을 못 불러왔어요 (${e.message})`);
    }
    return { kr, us, realized, warn };
  }

  // 직접 넣은 종목의 현재가. 국내·미국 모두 한 번에 200개까지 물어볼 수 있어요.
  async function quote(cfg, ctx, items) {
    const out = {};
    const want = (items || []).map(it => ({ key: it && it.key, sym: String((it && it.code) || '').trim().toUpperCase() }))
      .filter(w => w.key != null && /^[A-Z0-9.\-]+$/.test(w.sym));
    if (!want.length) return out;
    creds(cfg);
    const st = await connect(cfg), price = {};
    const ask = async list => {
      const r = await call(cfg, ctx, st, 'GET', '/api/v1/prices?symbols=' + list.join(','), { group: 'MARKET_DATA' });
      for (const p of Array.isArray(r) ? r : []) if (p && p.symbol) price[String(p.symbol).toUpperCase()] = num(p.lastPrice);
    };
    const syms = [...new Set(want.map(w => w.sym))];
    for (let i = 0; i < syms.length; i += 200) {
      const chunk = syms.slice(i, i + 200);
      try { await ask(chunk); }
      catch (e) {
        if (e.fatal) throw e;
        // 모르는 종목이 하나라도 섞이면 404가 올 수 있어서 하나씩 다시 물어봐요.
        if (e.status === 404 && chunk.length > 1) {
          for (const s of chunk) { try { await ask([s]); } catch (e2) { if (e2.fatal) throw e2; } }
        }
      }
    }
    for (const w of want) if (price[w.sym] > 0) out[w.key] = { price: price[w.sym] };
    return out;
  }

  window.MoaBrokers.register({
    id: 'toss',
    name: '토스증권',
    fields: [
      { key: 'client_id', label: 'Client ID', placeholder: 'tsck_live_로 시작해요' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
      { key: 'relay', label: '중계 프로그램 주소 (선택)', placeholder: DEFAULT_RELAY, optional: true }
    ],
    help: '<ol><li>토스증권 <b>PC 웹</b>에 로그인 → <b>설정 → Open API</b>에서 <b>Client ID</b>와 <b>Client Secret</b>을 발급받아요.</li>'
      + '<li>집 PC에서 <b>토스 중계 프로그램</b>을 켜요 (<a href="https://github.com/ConverseDDULULU/moa-money/blob/main/toss-relay/README.md" target="_blank" rel="noopener">받고 켜는 법</a>). 창에 나온 IP를 같은 화면 아래 <b>허용 IP 관리</b>에 등록해요.</li>'
      + '<li>그 PC의 브라우저에서 이 화면을 열고 불러와요. 휴대폰에서는 직접 못 불러오지만, 동기화를 켜 두면 결과가 휴대폰에도 보여요.</li></ol>',
    notes: '집 PC에서 중계 프로그램을 켜 둔 동안 그 PC에서만 불러올 수 있어요. 키는 이 기기에만 저장돼요.',
    refresh,
    quote
  });
})();
