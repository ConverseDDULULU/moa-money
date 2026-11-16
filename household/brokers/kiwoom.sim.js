// 키움증권 샘플 응답 (시뮬레이션용, 지어낸 예시 숫자). 네트워크를 쓰지 않아요.
// 본체가 '샘플로 해 보기'를 누르면 fetch를 잠깐 이 함수로 돌려서, 진짜 kiwoom.js를 그대로 실행해요.
// 응답 모양은 키움 REST API 명세(openapi.kiwoom.com)의 항목 이름·형식과 같아요:
//   0채움 부호 문자열("-00000000196888"), 국내 종목코드 'A' 접두어, 연속조회 헤더 cont-yn / next-key.
// 안전장치: 샘플 키(appkey가 'SAMPLE'로 시작)와 샘플 토큰에만 답해요. 진짜 키·토큰 요청이면 null을 돌려줘서
// 본체가 그대로 진짜 키움으로 보내요 (진짜 계좌에 샘플 숫자가 섞이지 않게).
(function () {
  window.MoaBrokerSim = window.MoaBrokerSim || {};

  const BASE = 'https://api.kiwoom.com';
  const TOKEN = 'SAMPLE-TOKEN-KIWOOM';
  const FX = 1452.3;
  const PATH = {
    kt00018: '/api/dostk/acnt', ka10001: '/api/dostk/stkinfo',
    ust21070: '/api/us/acnt', ust21530: '/api/us/acnt',
    usa10098: '/api/us/stkinfo', usa20100: '/api/us/mrkcond'
  };

  /* ---------- 형식 도우미 ---------- */
  // 0채움 부호 숫자: 양수 '000000000373500'(w자리), 음수 '-00000000196888'(부호 포함 w자리)
  const pad = (n, w) => { const s = String(Math.abs(Math.round(n))); return n < 0 ? '-' + s.padStart(w - 1, '0') : s.padStart(w, '0'); };
  const sgn = (n, d) => (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(d);   // '+201.4700', '-59000'
  const fix = (n, d) => n.toFixed(d);
  const floor10 = n => Math.floor(n / 10) * 10;
  const ymdLocal = t => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
  const kstStamp = ms => new Date(ms + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(0, 14);
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

  const J = (o, apiId, h = {}) => new Response(JSON.stringify(o), {
    status: 200,
    headers: { 'content-type': 'application/json;charset=UTF-8', 'cont-yn': 'N', 'next-key': '', 'api-id': apiId || '', ...h }
  });
  const OK = (o, apiId, h) => J({ ...o, return_code: 0, return_msg: '조회가 완료되었습니다' }, apiId, h);
  const ERR = (code, text, apiId) => J({ return_code: 2, return_msg: `조회에 실패했습니다[${code}:${text}]` }, apiId);

  /* ---------- 지어낸 계좌 ---------- */
  // [종목코드, 이름, 수량, 평균 매입가, 현재가, ETF?]
  const KR = [
    ['005930', '삼성전자', 20, 64300, 81200, 0],
    ['000660', 'SK하이닉스', 4, 178500, 214500, 0],
    ['069500', 'KODEX 200', 40, 34120, 41250, 1],
    ['035420', 'NAVER', 6, 221000, 196800, 0]
  ];
  const KR_MORE = { '005380': ['현대차', 214000], '035720': ['카카오', 41850], '360750': ['TIGER 미국S&P500', 23900] };
  // [티커, 이름, 영문명, 수량, 평균 매입가, 현재가, 거래소]
  const US = [
    ['AAPL', '애플', 'APPLE INC', 12, 198.45, 236.4, 'ND'],
    ['MSFT', '마이크로소프트', 'MICROSOFT CORP', 5, 405.1, 448.3, 'ND'],
    ['VOO', '뱅가드 S&P500 ETF', 'VANGUARD S&P 500 ETF', 4, 512.0, 571.8, 'NA']
  ];
  const US_MORE = {
    NVDA: ['엔비디아', 'NVIDIA CORP', 188.4, 'ND'], TSLA: ['테슬라', 'TESLA INC', 351.2, 'ND'],
    AMZN: ['아마존', 'AMAZON.COM INC', 214.6, 'ND'], QQQ: ['인베스코 QQQ', 'INVESCO QQQ TRUST', 613.1, 'ND'],
    KO: ['코카콜라', 'COCA-COLA CO', 70.12, 'NY'], SCHD: ['슈왑 미국배당 ETF', 'SCHWAB US DIVIDEND EQUITY ETF', 29.71, 'NA']
  };
  // 해외 실현손익: [월일, 티커, 이름, 거래소명, 수량, 매수 단가(USD), 매수 환율, 매도 단가(USD), 매도 환율]
  const SOLD_THIS_YEAR = [
    ['0318', 'NVDA', '엔비디아', '나스닥', 10, 118.4, 1338.5, 176.9, 1421.7],
    ['0805', 'TSLA', '테슬라', '나스닥', 3, 412.3, 1365.2, 338.75, 1402.4]
  ];
  const SOLD_LAST_YEAR = [['1014', 'AMZN', '아마존', '나스닥', 8, 142.6, 1312.8, 196.2, 1385.6]];
  const EX_NAME = { ND: 'NASDAQ', NY: 'NYSE', NA: 'AMEX' };

  /* ---------- kt00018 국내 잔고 (2쪽으로 나눠 연속조회 흉내) ---------- */
  function krRows() {
    const rows = KR.map(([code, name, q, avg, now, etf]) => {
      const pur = q * avg, evlt = q * now;
      const purCm = floor10(pur * 0.00015), sellCm = floor10(evlt * 0.00015), tax = etf ? 0 : Math.floor(evlt * 0.0018);
      const pl = evlt - pur - purCm - sellCm - tax;
      const prev = Math.round(now * (1 - ((hash(code) % 41) - 20) / 1000) / 100) * 100;
      return {
        stk_cd: 'A' + code, stk_nm: name, evltv_prft: pad(pl, 15), prft_rt: fix((pl / pur) * 100, 2),
        pur_pric: pad(avg, 15), pred_close_pric: pad(prev, 12), rmnd_qty: pad(q, 15), trde_able_qty: pad(q, 15),
        cur_prc: pad(now, 12), pred_buyq: pad(0, 15), pred_sellq: pad(0, 15), tdy_buyq: pad(0, 15), tdy_sellq: pad(0, 15),
        pur_amt: pad(pur, 15), pur_cmsn: pad(purCm, 15), evlt_amt: pad(evlt, 15), sell_cmsn: pad(sellCm, 15),
        tax: pad(tax, 15), sum_cmsn: pad(purCm + sellCm, 15), poss_rt: '0.00', crd_tp: '00', crd_tp_nm: '', crd_loan_dt: '',
        _evlt: evlt, _pur: pur, _pl: pl
      };
    });
    const totEvlt = rows.reduce((s, r) => s + r._evlt, 0), totPur = rows.reduce((s, r) => s + r._pur, 0), totPl = rows.reduce((s, r) => s + r._pl, 0);
    rows.forEach(r => { r.poss_rt = fix((r._evlt / totEvlt) * 100, 2); delete r._evlt; delete r._pur; delete r._pl; });
    const head = {
      tot_pur_amt: pad(totPur, 15), tot_evlt_amt: pad(totEvlt, 15), tot_evlt_pl: pad(totPl, 15),
      tot_prft_rt: fix((totPl / totPur) * 100, 2), prsm_dpst_aset_amt: pad(totEvlt + 1250000, 15),
      tot_loan_amt: pad(0, 15), tot_crd_loan_amt: pad(0, 15), tot_crd_ls_amt: pad(0, 15)
    };
    return { head, rows };
  }

  /* ---------- ust21070 미국 잔고 ---------- */
  function usBalance() {
    const rows = US.map(([sym, name, , q, avg, now]) => {
      const book = q * avg, evlt = q * now, pl = evlt - book;
      return {
        stex_nm: '미국', crnc_code: 'USD', stk_cd: sym, frgn_stk_nm: name,
        qty: pad(q, 12), poss_qty: pad(q, 12), sell_alowq: pad(q, 12),
        pred_cntr_sellq: pad(0, 12), pred_cntr_buyq: pad(0, 12), tdy_cntr_sellq: pad(0, 12), tdy_cntr_buyq: pad(0, 12),
        frgn_stk_book_uv: fix(avg, 4), now_pric: fix(now, 4), evlt_amt: fix(evlt, 4), pl_amt: fix(pl, 4),
        pl_rt: fix((pl / book) * 100, 2), evlt_amt_krw: pad(evlt * FX, 12), pl_amt_krw: pad(pl * FX, 12), natn_nm: '미국',
        exch_rate: fix(FX, 2), frgn_stk_book_uv_krw: pad(avg * FX, 12), now_pric_krw: pad(now * FX, 12),
        frgn_stk_book_amt: fix(book, 4), frgn_stk_book_amt_krw: pad(book * FX, 12)
      };
    });
    const tEv = US.reduce((s, u) => s + u[3] * u[5], 0), tBk = US.reduce((s, u) => s + u[3] * u[4], 0);
    return {
      stex_tp: '000030', crnc_code: 'USD', tot_evlt_amt: fix(tEv, 4), tot_prch_amt: fix(tBk, 4), tot_pl_amt: fix(tEv - tBk, 4),
      tot_pl_rt: fix(((tEv - tBk) / tBk) * 100, 2), tdy_book_amt: '0.0000', tdy_pl_amt: '0.0000', tdy_pl_rt: '0.00',
      tot_evlt_amt_krw: pad(tEv * FX, 15), tot_prch_amt_krw: pad(tBk * FX, 15), tot_pl_amt_krw: pad((tEv - tBk) * FX, 15),
      tdy_book_amt_krw: pad(0, 15), tdy_pl_amt_krw: pad(0, 15), result_list: rows
    };
  }

  /* ---------- ust21530 미국 실현손익 (기간 안의 매도만) ---------- */
  function realized(body) {
    const from = String(body.strt_dt || ''), to = String(body.end_dt || ''), krw = String(body.fc_krw_tp) === '1';
    const y = from.slice(0, 4), now = ymdLocal(new Date()), thisYear = now.slice(0, 4);
    const end = to && to < now ? to : now;
    const src = y === thisYear ? SOLD_THIS_YEAR : String(+thisYear - 1) === y ? SOLD_LAST_YEAR : [];
    const rows = [];
    src.forEach(([md, sym, name, exNm, q, bu, bfx, su, sfx]) => {
      let d = y + md;
      if (d > end) d = end;                         // 올해 초라면 오늘 날짜로 당겨요
      if (!/^\d{8}$/.test(d) || d < from || (to && d > to)) return;
      const bUsd = q * bu, sUsd = q * su;
      const buy = krw ? Math.round(bUsd * bfx) : bUsd, sell = krw ? Math.round(sUsd * sfx) : sUsd;
      const cm = krw ? Math.round((buy + sell) * 0.0025) : +((buy + sell) * 0.0025).toFixed(2);
      const pl = sell - buy - cm;
      const fxGain = Math.round(bUsd * (sfx - bfx));
      rows.push({
        sell_dt: d, stk_cd: sym, frgn_stk_nm: name, sell_qty: pad(q, 12),
        avg_buy_uv: fix(buy / q, 2), buy_amt: fix(buy, 2), avg_sell_uv: fix(sell / q, 2), sell_amt: fix(sell, 2),
        cmsn_tax: fix(cm, 2), pl_amt: fix(pl, 2), pl_rt: fix((pl / buy) * 100, 2),
        prch_exrt: fix(bfx, 2), sell_exrt: fix(sfx, 2),
        krw_chg_dfrn_pl_amt: pad(fxGain, 15), krw_chg_pl_amt: pad(Math.round(krw ? pl - fxGain : pl * sfx - fxGain), 15),
        comm_ord_tp: 'AB', stex_nm: exNm, natn_nm: '미국'
      });
    });
    const sum = k => rows.reduce((s, r) => s + Number(r[k]), 0);
    const tb = sum('buy_amt'), tpl = sum('pl_amt');
    return {
      tot_sell_amt: fix(sum('sell_amt'), 2), tot_buy_amt: fix(tb, 2), tot_cmsn_tax: fix(sum('cmsn_tax'), 2),
      tot_exct_amt: fix(sum('sell_amt') - sum('cmsn_tax'), 2), tot_pl_amt: fix(tpl, 2), tot_pl_rt: fix(tb ? (tpl / tb) * 100 : 0, 2),
      result_list: rows
    };
  }

  /* ---------- 시세 ---------- */
  function krQuote(code) {
    const c = String(code || '').replace(/^A(?=\w{6}$)/, '').replace(/_(NX|AL)$/, '');
    const own = KR.find(k => k[0] === c), more = KR_MORE[c];
    if (!own && !/^[0-9][0-9A-Z]{5}$/.test(c)) return null;
    const h = hash(c);
    const name = own ? own[1] : more ? more[0] : '샘플종목' + c;
    const now = own ? own[4] : more ? more[1] : 5000 + (h % 2950) * 100;   // 5,000 ~ 299,900원
    const base = Math.round(now / (1 + ((h % 61) - 30) / 1000) / 10) * 10;
    const diff = now - base;
    return {
      stk_cd: c, stk_nm: name, setl_mm: '12', cur_prc: sgn(now, 0), pred_pre_sig: diff > 0 ? '2' : diff < 0 ? '5' : '3',
      pred_pre: sgn(diff, 0), flu_rt: sgn((diff / base) * 100, 2), base_pric: String(base),
      open_pric: sgn(base, 0), high_pric: sgn(Math.max(now, base), 0), low_pric: sgn(Math.min(now, base), 0),
      trde_qty: String(100000 + (h % 900000))
    };
  }
  function usInfo(sym) {
    const t = String(sym || '').toUpperCase();
    const own = US.find(u => u[0] === t), more = US_MORE[t];
    if (own) return { t, name: own[1], en: own[2], now: own[5], ex: own[6] };
    if (more) return { t, name: more[0], en: more[1], now: more[2], ex: more[3] };
    if (!/^[A-Z][A-Z.]{0,5}$/.test(t)) return null;
    const h = hash(t);
    return { t, name: t, en: t + ' (SAMPLE)', now: 10 + (h % 59000) / 100, ex: h % 2 ? 'NY' : 'ND' };   // 10 ~ 600달러
  }

  /* ---------- 라우터 ---------- */
  window.MoaBrokerSim.kiwoom = async function (url, init) {
    let u;
    try { u = new URL(typeof url === 'string' ? url : url && url.url); } catch (e) { return null; }
    if (u.origin !== BASE) return null;
    const raw = (init && init.headers) || {};
    const hget = k => {
      if (typeof raw.get === 'function') return raw.get(k);
      const key = Object.keys(raw).find(x => x.toLowerCase() === k);
      return key ? raw[key] : null;
    };
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }

    if (u.pathname === '/oauth2/token') {
      if (!/^SAMPLE/.test(String(body.appkey || ''))) return null;     // 진짜 키는 진짜 키움으로
      return J({ expires_dt: kstStamp(Date.now() + 24 * 3600e3), token_type: 'bearer', token: TOKEN, return_code: 0, return_msg: '정상적으로 처리되었습니다' });
    }
    if (String(hget('authorization') || '') !== 'Bearer ' + TOKEN) return null;   // 진짜 토큰은 진짜 키움으로

    const id = String(hget('api-id') || '');
    if (!PATH[id]) return ERR(1505, `해당 API ID는 존재하지 않습니다. API ID=${id}`, id);
    if (PATH[id] !== u.pathname) return ERR(1504, `해당 URI에서는 지원하는 API ID가 아닙니다. API ID=${id}, URI=${u.pathname}`, id);

    if (id === 'kt00018') {
      const { head, rows } = krRows();
      if (String(hget('next-key') || '') === 'SAMPLE-NEXT-2') return OK({ ...head, acnt_evlt_remn_indv_tot: rows.slice(3) }, id);
      return OK({ ...head, acnt_evlt_remn_indv_tot: rows.slice(0, 3) }, id, { 'cont-yn': 'Y', 'next-key': 'SAMPLE-NEXT-2' });
    }
    if (id === 'ust21070') return J({ ...usBalance(), return_code: 0, return_msg: '계좌잔고내역이 조회되었습니다.' }, id);
    if (id === 'ust21530') return J({ ...realized(body), return_code: 0, return_msg: '조회가 완료되었습니다.' }, id);
    if (id === 'ka10001') {
      const q = krQuote(body.stk_cd);
      return q ? J({ ...q, return_code: 0, return_msg: '정상적으로 처리되었습니다' }, id)
        : ERR(1902, `종목 정보가 없습니다. 입력한 종목코드 값을 확인바랍니다. 종목코드=${body.stk_cd}`, id);
    }
    if (id === 'usa10098') {
      const i = usInfo(body.stk_cd);
      const list = i ? [{ stex_tp: i.ex, stk_cd: i.t, stk_nm: i.name, stk_enm: i.en, mkgb: EX_NAME[i.ex], upgb: '', isEtf: /ETF|QQQ|VOO|SCHD/.test(i.name + i.t) ? 'Y' : 'N' }] : [];
      return J({ return_msg: '정상적으로 처리되었습니다', list, return_code: 0 }, id);
    }
    if (id === 'usa20100') {
      const i = usInfo(body.stk_cd);
      if (!i || i.ex !== String(body.stex_tp || '').toUpperCase()) {
        return ERR(1903, `종목 정보가 없습니다. 입력한 종목코드, 거래소구분 값을 확인바랍니다. 거래소구분=${body.stex_tp}, 종목코드=${body.stk_cd}`, id);
      }
      const base = +(i.now / (1 + ((hash(i.t) % 41) - 20) / 1000)).toFixed(4), diff = i.now - base;
      return J({
        stex_tp: i.ex, stk_cd: i.t, stk_nm: i.name, stk_enm: i.en, cur_prc: sgn(i.now, 4),
        pred_pre_sig: diff > 0 ? '2' : diff < 0 ? '5' : '3', pred_pre: sgn(diff, 4), flu_rt: sgn((diff / base) * 100, 2),
        base_close_pric: fix(base, 4), curr_unit: 'USD', trde_qty_unit: '1', trd_susp_tp: '0', base_exrt: fix(FX, 2),
        return_code: 0, return_msg: '정상적으로 처리되었습니다'
      }, id);
    }
    return null;
  };
})();
