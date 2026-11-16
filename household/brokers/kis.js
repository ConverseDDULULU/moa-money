// 한국투자증권 연결 모듈 (조회 전용)
// 한국투자 API는 브라우저에서 바로 부를 수 없어서(사전 요청 차단) Cloudflare 중계의 /kis/ 통로를 거쳐요.
// 중계는 허용한 조회 5가지만 통과시키고 키를 저장하지 않아요. 키·토큰은 이 기기에만(ctx.saveCfg) 있어요.
// 필드 이름은 한국투자 공식 예제(github.com/koreainvestment/open-trading-api, examples_llm)에서 확인했어요.
(function () {
  if (!window.MoaBrokers) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const num = v => { const x = Number(String(v ?? '').replace(/,/g, '').trim()); return isFinite(x) ? x : 0; };
  const ymd = s => /^\d{8}$/.test(String(s)) ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6)}` : String(s || '');
  const ERR = {
    EGW00103: 'App Key가 맞지 않아요. 한국투자에서 받은 키를 다시 확인해 주세요',
    EGW00105: 'App Secret이 맞지 않아요. 다시 확인해 주세요',
    EGW00304: 'App Secret이 맞지 않아요. 다시 확인해 주세요',
    EGW00133: '한국투자 로그인은 1분에 한 번만 돼요. 1분 뒤에 다시 눌러 주세요',
    EGW00201: '잠깐 요청이 많았어요. 조금 뒤에 다시 눌러 주세요',
    EGW00215: '한국투자 서버가 바빠요. 조금 뒤에 다시 눌러 주세요',
    OPSQ2000: '계좌번호를 다시 확인해 주세요',
    OPSQ0002: '계좌번호를 다시 확인해 주세요'
  };
  const kisErr = (code, msg) => ERR[code] || (msg ? `한국투자: ${String(msg).trim()}` : '한국투자에서 오류가 났어요');

  function account(cfg) {
    const d = String(cfg.account || '').replace(/\D/g, '');
    if (d.length !== 10) throw new Error('계좌번호 10자리를 넣어 주세요 (예: 12345678-01)');
    return { CANO: d.slice(0, 8), ACNT_PRDT_CD: d.slice(8) };
  }
  const keys = cfg => {
    const appkey = String(cfg.appkey || '').trim(), appsecret = String(cfg.appsecret || '').trim();
    if (!appkey || !appsecret) throw new Error('App Key와 App Secret을 넣어 주세요');
    return { appkey, appsecret };
  };

  // 토큰은 24시간 유효해요. 새로 받을 때마다 카카오톡 알림이 가고 1분에 한 번만 받을 수 있어서 최대한 재사용해요.
  async function token(cfg, ctx) {
    if (cfg.token && cfg.tokenExp > Date.now() + 10 * 60 * 1000) return cfg.token;
    const k = keys(cfg);
    const wait = cfg.tokenAt ? 61000 - (Date.now() - cfg.tokenAt) : 0;
    if (wait > 0) { ctx.progress(`한국투자 로그인 대기 중… (${Math.ceil(wait / 1000)}초)`); await sleep(wait); }
    ctx.progress('한국투자 로그인 중…');
    let r;
    try { r = await fetch(ctx.relay + 'kis/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(k) }); }
    catch { throw new Error('중계 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요'); }
    const j = await r.json().catch(() => ({}));
    cfg.tokenAt = Date.now();
    if (!j.access_token) { ctx.saveCfg(cfg); throw new Error(kisErr(j.error_code || j.msg_cd, j.error_description || j.msg1)); }
    cfg.token = j.access_token;
    cfg.tokenExp = Date.now() + (num(j.expires_in) || 86400) * 1000;
    ctx.saveCfg(cfg);
    return cfg.token;
  }

  async function get(cfg, ctx, path, trId, params, trCont, retried) {
    const tok = await token(cfg, ctx), k = keys(cfg);
    let r;
    try {
      r = await fetch(ctx.relay + 'kis' + path + '?' + new URLSearchParams(params), {
        headers: { authorization: 'Bearer ' + tok, appkey: k.appkey, appsecret: k.appsecret, tr_id: trId, tr_cont: trCont || '', custtype: 'P' }
      });
    } catch { throw new Error('중계 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요'); }
    const j = await r.json().catch(() => ({}));
    if (!retried && (j.msg_cd === 'EGW00123' || j.msg_cd === 'EGW00121')) { cfg.token = null; ctx.saveCfg(cfg); return get(cfg, ctx, path, trId, params, trCont, true); }
    if (j.rt_cd !== '0') throw new Error(kisErr(j.msg_cd, j.msg1));
    return { j, cont: r.headers.get('tr_cont') || '' };
  }

  // 연속 조회: 응답 헤더 tr_cont가 M/F면 다음 쪽이 있어요. 본문의 ctx_area_* 값을 다음 요청에 넣어요.
  async function pages(cfg, ctx, path, trId, params, size) {
    const fk = `CTX_AREA_FK${size}`, nk = `CTX_AREA_NK${size}`;
    let p = { ...params, [fk]: '', [nk]: '' }, cont = '', rows = [], last = null;
    for (let i = 0; i < 20; i++) {
      const { j, cont: c } = await get(cfg, ctx, path, trId, p, cont);
      last = j;
      const out = j.output1 ?? j.output;
      if (Array.isArray(out)) rows = rows.concat(out); else if (out && typeof out === 'object') rows.push(out);
      if (c !== 'M' && c !== 'F') break;
      p = { ...p, [fk]: j[fk.toLowerCase()] || '', [nk]: j[nk.toLowerCase()] || '' };
      cont = 'N';
      await sleep(120);
    }
    return { rows, last };
  }

  async function refresh(cfg, ctx) {
    const a = account(cfg), warn = [], today = ctx.today().replace(/-/g, '');

    // 국내 주식 잔고 (TTTC8434R). 대출일별로 줄이 나뉠 수 있어서 종목코드로 합쳐요.
    ctx.progress('국내 주식 잔고 불러오는 중…');
    const dom = await pages(cfg, ctx, '/uapi/domestic-stock/v1/trading/inquire-balance', 'TTTC8434R', {
      ...a, AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '01', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00'
    }, 100);
    const byCode = new Map();
    for (const r of dom.rows) {
      const qty = num(r.hldg_qty); if (!(qty > 0)) continue;
      const o = byCode.get(r.pdno) || { code: r.pdno, name: r.prdt_name, market: 'KR', qty: 0, cost: 0, price: num(r.prpr), cur: 'KRW', value: 0, pl: 0 };
      o.qty += qty; o.cost += num(r.pchs_amt) || qty * num(r.pchs_avg_pric); o.value += num(r.evlu_amt); o.pl += num(r.evlu_pfls_amt);
      byCode.set(r.pdno, o);
    }
    const kr = [...byCode.values()].map(o => ({ code: o.code, name: o.name, market: 'KR', qty: o.qty, avg: o.qty ? o.cost / o.qty : 0, price: o.price, cur: 'KRW', value: o.value, pl: o.pl }));

    // 미국 주식 잔고 (TTTS3012R). 해외주식 서비스를 신청하지 않은 계좌면 오류가 나서 건너뛰어요.
    let us = [];
    try {
      ctx.progress('미국 주식 잔고 불러오는 중…');
      const ovs = await pages(cfg, ctx, '/uapi/overseas-stock/v1/trading/inquire-balance', 'TTTS3012R', { ...a, OVRS_EXCG_CD: 'NASD', TR_CRCY_CD: 'USD' }, 200);
      us = ovs.rows.filter(r => num(r.ovrs_cblc_qty) > 0).map(r => ({
        code: r.ovrs_pdno, name: r.ovrs_item_name || r.ovrs_pdno, market: 'US', qty: num(r.ovrs_cblc_qty),
        avg: num(r.pchs_avg_pric), price: num(r.now_pric2), cur: 'USD', value: num(r.ovrs_stck_evlu_amt), pl: num(r.frcr_evlu_pfls_amt),
        ex: r.ovrs_excg_cd === 'NYSE' ? 'NYS' : r.ovrs_excg_cd === 'AMEX' ? 'AMS' : 'NAS'
      }));
    } catch (e) { warn.push(`미국 주식 잔고를 못 불러왔어요 (${e.message})`); }

    // 해외주식 기간손익 (TTTS3039R, 원화 기준 02): 올해와 작년. 한국투자가 계산한 원화 실현손익을 그대로 써요.
    const realized = {}, y0 = Number(today.slice(0, 4));
    for (const y of [y0, y0 - 1]) {
      try {
        ctx.progress(`${y}년 해외주식 실현손익 불러오는 중…`);
        const end = y === y0 ? today : `${y}1231`;
        const pr = await pages(cfg, ctx, '/uapi/overseas-stock/v1/trading/inquire-period-profit', 'TTTS3039R', {
          ...a, OVRS_EXCG_CD: 'NASD', NATN_CD: '', CRCY_CD: 'USD', PDNO: '', INQR_STRT_DT: `${y}0101`, INQR_END_DT: end, WCRC_FRCR_DVSN_CD: '02'
        }, 200);
        realized[y] = pr.rows.filter(r => num(r.slcl_qty) > 0).map(r => ({
          date: ymd(r.trad_day), code: r.ovrs_pdno, name: r.ovrs_item_name || r.ovrs_pdno, qty: num(r.slcl_qty),
          gain: num(r.ovrs_rlzt_pfls_amt), proceeds: null, basis: null, exrt: num(r.exrt) || null
        }));
      } catch (e) { warn.push(`${y}년 해외 실현손익을 못 불러왔어요 (${e.message})`); }
      await sleep(120);
    }
    if (Object.values(realized).some(a => a.length)) warn.push('해외 실현손익은 한국투자가 원화로 계산한 금액이에요 (증권사 양도세 신고 자료와 같은 기준)');
    return { kr, us, realized, warn };
  }

  // 직접 넣은 종목의 현재가. 국내는 주식현재가 시세(FHKST01010100), 미국은 해외주식 현재체결가(HHDFS00000300).
  async function quote(cfg, ctx, items) {
    const out = {};
    for (const it of items) {
      try {
        if (it.market === 'KR') {
          const { j } = await get(cfg, ctx, '/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: String(it.code).trim() });
          const p = num(j.output && j.output.stck_prpr); if (p > 0) out[it.key] = { price: p };
        } else {
          for (const ex of [it.ex, 'NAS', 'NYS', 'AMS'].filter((v, i, a) => v && a.indexOf(v) === i)) {
            const { j } = await get(cfg, ctx, '/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: ex, SYMB: String(it.code).trim().toUpperCase() });
            const p = num(j.output && j.output.last);
            if (p > 0) { out[it.key] = { price: p, ex }; break; }
            await sleep(60);
          }
        }
      } catch (e) { if (/App Key|App Secret|로그인|중계/.test(e.message)) throw e; }
      await sleep(60);
    }
    return out;
  }

  window.MoaBrokers.register({
    id: 'kis',
    name: '한국투자증권',
    fields: [
      { key: 'appkey', label: 'App Key' },
      { key: 'appsecret', label: 'App Secret', secret: true },
      { key: 'account', label: '계좌번호', placeholder: '예: 12345678-01' }
    ],
    help: '<ol><li>한국투자증권 앱이나 홈페이지에서 <b>Open API 서비스 신청</b>을 해요 (KIS Developers: apiportal.koreainvestment.com).</li><li>발급된 <b>App Key</b>와 <b>App Secret</b>을 아래에 넣어요.</li><li>미국 주식도 보려면 <b>해외주식 서비스 신청</b>이 되어 있어야 해요.</li></ol>',
    notes: '불러올 때 한국투자가 하루 한 번쯤 카카오톡으로 접속 알림을 보내요. 키는 이 기기에만 저장돼요.',
    refresh,
    quote
  });
})();
