/* 모아 가계부 · 키움증권 연결 모듈 (조회 전용)
 *
 * 약속: household/brokers/README.md
 * 브라우저에서 https://api.kiwoom.com 을 직접 불러요 (CORS 허용). 키움에 등록한 IP에서만 동작해요.
 *
 * 쓰는 키움 REST TR (모두 조회용, 주문·이체 TR은 부르지 않아요)
 *   au10001  POST /oauth2/token       접근토큰 발급
 *   kt00018  POST /api/dostk/acnt     국내 계좌평가잔고내역 (초당 1회)
 *   ust21070 POST /api/us/acnt        미국주식 원장잔고확인
 *   ust21530 POST /api/us/acnt        미국주식 실현손익 (fc_krw_tp=1: 원화)
 *   ka10001  POST /api/dostk/stkinfo  국내 주식기본정보 (현재가)
 *   usa10098 POST /api/us/stkinfo     미국주식 거래소구분 조회
 *   usa20100 POST /api/us/mrkcond     미국주식 현재가 종목정보
 *
 * 키움 응답 특징
 *   - 오류도 HTTP 200. return_code가 0이 아니고, 진짜 코드는 return_msg 안에 있어요.
 *     예) {"return_code":3,"return_msg":"인증에 실패했습니다[8005:Token이 유효하지 않습니다]"}
 *   - 숫자는 0채움·부호 문자열 ("-00000000196888", "+201.4700"). 현재가의 부호는 전일 대비 방향이라 절댓값을 써요.
 *   - 연속조회: 응답 헤더 cont-yn: Y + next-key → 같은 요청에 헤더 cont-yn, next-key를 실어 다시 보내요.
 */
(function () {
  'use strict';

  var BASE = 'https://api.kiwoom.com';
  var MAX_PAGES = 50;
  var GAP = { kt00018: 1100 };   // TR별 최소 간격(ms). kt00018은 초당 1회
  var GAP_DEFAULT = 350;         // 그 외 초당 5회(미국 피크타임 3회)
  var EX = { ND: 'NAS', NY: 'NYS', NA: 'AMS' };
  var TOKEN_MARGIN = 10 * 60 * 1000;

  var MSG = {
    ip: '키움에 등록한 IP(집 와이파이)에서 열어 주세요. 지금 연결된 인터넷은 키움에 등록되어 있지 않아요.',
    key: 'App Key나 Secret Key가 맞지 않아요. 키움에서 받은 두 값을 다시 넣어 주세요.',
    nokey: 'App Key와 Secret Key를 넣어 주세요.',
    mock: '모의투자용 키예요. 실전투자 계좌의 App Key로 연결해 주세요.',
    token: '키움 접속이 끊겼어요. 잠시 뒤 다시 불러와 주세요.',
    auth: '키움 인증에 실패했어요. 잠시 뒤 다시 해 주세요.',
    busy: '키움 조회가 잠시 몰렸어요. 1분쯤 뒤에 다시 불러와 주세요.',
    net: '키움에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.',
    corp: '법인 계좌는 키움이 이 조회를 열어 주지 않아요.'
  };
  // 코드 → [문구, 치명적(=더 진행하지 않고 바로 알림)]
  var CODES = {
    8050: ['ip', 1], 8010: ['ip', 1],
    8001: ['key', 1], 8002: ['key', 1], 8020: ['key', 1], 8011: ['key', 1], 8012: ['key', 1],
    8030: ['mock', 1], 8031: ['mock', 1],
    8003: ['token', 1], 8005: ['token', 1], 8006: ['token', 1], 8009: ['token', 1],
    8040: ['auth', 1], 8103: ['auth', 1],
    1700: ['busy', 1], 1701: ['busy', 1], 1702: ['busy', 1],
    8200: ['corp', 0]
  };
  var RETRY_TOKEN = { 8010: 1, 8005: 1, 8003: 1 };
  var RETRY_BUSY = { 1700: 1, 1701: 1, 1702: 1 };
  var NO_DATA = /(자료|데이터|내역|대상|잔고)[가이]?\s*(존재하지\s*)?않|(자료|데이터|내역|대상|잔고)[가이]?\s*없/;

  /* ---------- 작은 도구 ---------- */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = str(v).replace(/[,\s]/g, '');
    if (!s) return 0;
    var n = Number(s);
    return isFinite(n) ? (n || 0) : 0;
  }
  function abs(v) { return Math.abs(num(v)); }
  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
  function ymd(s) {
    var m = /^(\d{4})(\d{2})(\d{2})/.exec(str(s).replace(/-/g, ''));
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }
  function krCode(v) {
    var s = str(v).toUpperCase().replace(/_(NX|AL)$/, '');
    return /^[AJQ][0-9A-Z]{6}$/.test(s) ? s.slice(1) : s;   // A005930 → 005930
  }
  function kstMs(dt) {   // 'YYYYMMDDHHMMSS'(한국시간) → epoch ms
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(str(dt));
    if (!m) return Date.now() + 12 * 3600 * 1000;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);
  }
  function todayOf(ctx) {
    var t = '';
    try { t = ctx && ctx.today ? str(ctx.today()) : ''; } catch (e) { t = ''; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function progress(ctx, text) { try { if (ctx && ctx.progress) ctx.progress(text); } catch (e) { /* 무시 */ } }
  function save(cfg, ctx) { if (ctx && ctx.saveCfg) ctx.saveCfg(cfg); }

  function fail(kind, fatal, code) {
    var e = new Error(MSG[kind] || kind);
    e.fatal = !!fatal;
    if (code) e.kwCode = code;
    return e;
  }
  function codeOf(json) {
    if (!json || json.return_code == null || json.return_code === '') return 0;
    var rc = Number(json.return_code);
    if (rc === 0) return 0;
    var m = /\[(\d{4})\s*:/.exec(str(json.return_msg));
    return m ? +m[1] : (rc || -1);
  }
  function apiError(code, json) {
    var c = CODES[code];
    if (c) return fail(c[0], c[1], code);
    var raw = str(json && json.return_msg);
    var inner = /\[\d{4}\s*:\s*([^\]]*)\]/.exec(raw);
    var msg = str(inner ? inner[1] : raw) || '알 수 없는 오류 (코드 ' + code + ')';
    var e = new Error('키움에서 오류가 났어요: ' + msg);
    e.fatal = false;
    e.kwCode = code;
    return e;
  }

  /* ---------- 호출 (한 번에 하나씩, TR별 간격 지켜서) ---------- */

  var queue = Promise.resolve();
  var lastCall = {};
  function serial(fn) {
    var p = queue.then(fn, fn);
    queue = p.then(function () {}, function () {});
    return p;
  }

  function post(path, apiId, body, token, nextKey) {
    return serial(async function () {
      var pace = apiId || path;
      var wait = (lastCall[pace] || 0) + (GAP[apiId] || GAP_DEFAULT) - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall[pace] = Date.now();

      var headers = { 'Content-Type': 'application/json;charset=UTF-8' };
      if (apiId) headers['api-id'] = apiId;
      if (token) headers.authorization = 'Bearer ' + token;
      if (nextKey) { headers['cont-yn'] = 'Y'; headers['next-key'] = nextKey; }

      var res;
      try {
        res = await fetch(BASE + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) });
      } catch (e) {
        throw fail('net', 1);
      }
      var json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (!json || typeof json !== 'object') {
        var e2 = new Error(res.ok ? '키움 응답을 읽지 못했어요. 잠시 뒤 다시 해 주세요.'
          : '키움 서버가 응답하지 않아요 (HTTP ' + res.status + '). 잠시 뒤 다시 해 주세요.');
        e2.fatal = true;
        throw e2;
      }
      var h = res.headers;
      return {
        json: json,
        more: str(h && h.get('cont-yn')).toUpperCase() === 'Y',
        next: str(h && h.get('next-key'))
      };
    });
  }

  /* ---------- 토큰 (24시간, 이 기기에만 저장) ---------- */

  var tokenJobs = {};   // 같은 키로 동시에 두 번 발급하지 않게

  function tokenValid(cfg) {
    return !!cfg.token && cfg.tokenFor === str(cfg.appkey) && num(cfg.tokenExp) - Date.now() > TOKEN_MARGIN;
  }
  function dropToken(cfg, ctx) {
    cfg.token = ''; cfg.tokenExp = 0;
    save(cfg, ctx);
  }
  async function issueToken(appkey, secretkey) {
    var r = await post('/oauth2/token', null, { grant_type: 'client_credentials', appkey: appkey, secretkey: secretkey });
    var code = codeOf(r.json);
    if (code) throw apiError(code, r.json);
    if (!r.json.token) throw fail('auth', 1);
    return { token: str(r.json.token), exp: kstMs(r.json.expires_dt) };
  }
  function getToken(cfg, ctx) {
    if (tokenValid(cfg)) return Promise.resolve(cfg.token);
    var appkey = str(cfg.appkey), secretkey = str(cfg.secretkey);
    if (!appkey || !secretkey) return Promise.reject(fail('nokey', 1));
    var job = tokenJobs[appkey];
    if (!job) {
      job = tokenJobs[appkey] = issueToken(appkey, secretkey);
      var clear = function () { delete tokenJobs[appkey]; };
      job.then(clear, clear);
    }
    return job.then(function (t) {
      if (cfg.token !== t.token) {
        cfg.token = t.token; cfg.tokenExp = t.exp; cfg.tokenFor = appkey;
        save(cfg, ctx);
      }
      return t.token;
    });
  }

  // listKey가 있으면 연속조회로 모든 줄을 모아요. 없으면 첫 응답만.
  async function call(cfg, ctx, path, apiId, body, listKey) {
    var rows = [], head = null, next = '', pages = 0, tokenRetry = 0, busyRetry = 0;
    for (;;) {
      var token = await getToken(cfg, ctx);
      var r = await post(path, apiId, body, token, next);
      var code = codeOf(r.json);
      if (code) {
        if (RETRY_TOKEN[code] && !tokenRetry) { tokenRetry = 1; dropToken(cfg, ctx); continue; }
        if (RETRY_BUSY[code] && busyRetry < 2) { busyRetry++; await sleep(1100); continue; }
        if (!CODES[code] && NO_DATA.test(str(r.json.return_msg))) break;   // '조회할 자료가 없습니다' 같은 빈 결과
        throw apiError(code, r.json);
      }
      if (!head) head = r.json;
      if (!listKey) break;
      var list = r.json[listKey];
      if (Array.isArray(list)) rows.push.apply(rows, list);
      if (!r.more || !r.next || r.next === next || ++pages >= MAX_PAGES) break;
      next = r.next;
    }
    return { head: head || {}, rows: rows };
  }

  /* ---------- 보유 종목 ---------- */

  function merge(list) {   // 같은 종목이 여러 줄(현금·신용 등)로 오면 한 줄로
    var by = {}, out = [];
    list.forEach(function (h) {
      var k = h.market + ':' + h.code, a = by[k];
      if (!a) { by[k] = h; out.push(h); return; }
      var q = a.qty + h.qty;
      a.avg = q ? round((a.avg * a.qty + h.avg * h.qty) / q, 4) : a.avg;
      a.qty = q;
      a.value = round(a.value + h.value, 4);
      a.pl = round(a.pl + h.pl, 4);
      if (!a.price) a.price = h.price;
    });
    return out;
  }

  async function domestic(cfg, ctx) {
    var r = await call(cfg, ctx, '/api/dostk/acnt', 'kt00018',
      { qry_tp: '1', dmst_stex_tp: 'KRX' }, 'acnt_evlt_remn_indv_tot');
    return merge(r.rows.map(function (x) {
      return {
        code: krCode(x.stk_cd), name: str(x.stk_nm), market: 'KR',
        qty: num(x.rmnd_qty), avg: abs(x.pur_pric), price: abs(x.cur_prc),
        cur: 'KRW', value: num(x.evlt_amt), pl: num(x.evltv_prft)
      };
    }).filter(function (h) { return h.code && h.qty > 0; }));
  }

  async function overseas(cfg, ctx) {
    var r = await call(cfg, ctx, '/api/us/acnt', 'ust21070', { stex_tp: '', stk_cd: '' }, 'result_list');
    return merge(r.rows.filter(function (x) {
      var c = str(x.crnc_code).toUpperCase();
      return !c || c === 'USD';
    }).map(function (x) {
      var code = str(x.stk_cd).toUpperCase();
      return {
        code: code, name: str(x.frgn_stk_nm) || code, market: 'US',
        qty: num(x.poss_qty), avg: abs(x.frgn_stk_book_uv), price: abs(x.now_pric),
        cur: 'USD', value: num(x.evlt_amt), pl: num(x.pl_amt)
      };
    }).filter(function (h) { return h.code && h.qty > 0; }));
  }

  /* ---------- 해외주식 실현손익 (키움이 계산한 원화 손익) ---------- */

  function realizedRow(x) {
    return {
      date: ymd(x.sell_dt), code: str(x.stk_cd).toUpperCase(), name: str(x.frgn_stk_nm) || str(x.stk_cd),
      qty: num(x.sell_qty),
      gain: Math.round(num(x.pl_amt)),          // 매도금액 - 매입금액 - 수수료제세금 (원)
      proceeds: Math.round(num(x.sell_amt)) || null,
      basis: Math.round(num(x.buy_amt)) || null,
      exrt: abs(x.sell_exrt) || null
    };
  }

  async function realizedRange(cfg, ctx, from, to) {
    var r = await call(cfg, ctx, '/api/us/acnt', 'ust21530',
      { strt_dt: from, end_dt: to, fc_krw_tp: '1' }, 'result_list');
    return r.rows;
  }

  async function realizedYear(cfg, ctx, year, endYmd) {
    var from = year + '0101', rows;
    try {
      rows = await realizedRange(cfg, ctx, from, endYmd);
    } catch (e) {
      if (e.fatal) throw e;
      // 기간 제한이 있을 수 있어 한 달씩 다시 물어봐요
      rows = [];
      var lastMonth = +endYmd.slice(4, 6);
      for (var m = 1; m <= lastMonth; m++) {
        var mm = (m < 10 ? '0' : '') + m;
        var end = m === lastMonth ? endYmd : year + mm + String(new Date(Date.UTC(year, m, 0)).getUTCDate());
        rows = rows.concat(await realizedRange(cfg, ctx, year + mm + '01', end));
      }
    }
    return rows.map(realizedRow).filter(function (x) {
      return x.date && x.date.slice(0, 4) === String(year) && x.code;
    });
  }

  /* ---------- 등록 ---------- */

  var root = typeof window !== 'undefined' ? window : this;
  if (!root || !root.MoaBrokers || typeof root.MoaBrokers.register !== 'function') return;

  root.MoaBrokers.register({
    id: 'kiwoom',
    name: '키움증권',
    fields: [
      { key: 'appkey', label: 'App Key' },
      { key: 'secretkey', label: 'Secret Key', secret: true }
    ],
    help:
      '<p><a href="https://openapi.kiwoom.com" target="_blank" rel="noopener">키움 REST API</a>에서 ' +
      '<b>API 사용신청</b> → <b>계좌 App Key 관리</b>로 가요.</p>' +
      '<ol>' +
      '<li><b>IP 등록</b>: 이 기기가 쓰는 인터넷(집 와이파이)의 IP를 등록해요. \'현재 나의 IP\'를 누르면 보여요.</li>' +
      '<li><b>계좌 등록</b> 뒤 App Key와 App Secret을 내려받아요. 내려받기는 한 번만 돼요.</li>' +
      '<li>받은 두 값(계좌번호_appkey.txt, 계좌번호_appsecret.txt)을 아래에 붙여 넣어요. 모의투자 키는 안 돼요.</li>' +
      '</ol>' +
      '<p>키는 이 기기에만 저장되고 잔고 조회에만 써요. 주문은 하지 않아요.</p>',
    notes: '키움에 등록한 IP(집 와이파이 등)에서만 불러올 수 있어요.',

    refresh: async function (cfg, ctx) {
      cfg = cfg || {};
      var warn = [];
      var today = todayOf(ctx);
      var year = +today.slice(0, 4);

      progress(ctx, '키움 국내 잔고 불러오는 중…');
      var kr = await domestic(cfg, ctx);

      var us = [];
      progress(ctx, '키움 해외 잔고 불러오는 중…');
      try {
        us = await overseas(cfg, ctx);
      } catch (e) {
        if (e.fatal) throw e;
        warn.push('키움 해외 잔고를 불러오지 못했어요 (' + e.message + ')');
      }

      var realized = {}, gotRealized = false;
      progress(ctx, '키움 해외 실현손익 불러오는 중…');
      var years = [[year, today.replace(/-/g, '')], [year - 1, (year - 1) + '1231']];
      for (var i = 0; i < years.length; i++) {
        try {
          realized[years[i][0]] = await realizedYear(cfg, ctx, years[i][0], years[i][1]);
          gotRealized = true;
        } catch (e) {
          if (e.fatal) throw e;
          warn.push(years[i][0] + '년 키움 해외 실현손익을 불러오지 못했어요 (' + e.message + ')');
        }
      }
      if (gotRealized) {
        warn.push('키움 해외 실현손익은 키움이 계산한 원화 손익을 그대로 썼어요 (매수·매도 때 환율, 수수료·세금 반영).');
      }

      return { kr: kr, us: us, realized: realized, warn: warn };
    },

    quote: async function (cfg, ctx, items) {
      cfg = cfg || {};
      var out = {};
      var exMap = cfg.usEx && typeof cfg.usEx === 'object' ? cfg.usEx : (cfg.usEx = {});
      var dirty = false;

      async function usPrice(t, ex) {
        try {
          var q = await call(cfg, ctx, '/api/us/mrkcond', 'usa20100', { stex_tp: ex, stk_cd: t }, null);
          return abs(q.head.cur_prc);
        } catch (e) {
          if (e.fatal) throw e;
          return 0;
        }
      }
      async function lookupEx(t) {
        try {
          var l = await call(cfg, ctx, '/api/us/stkinfo', 'usa10098', { stk_cd: t }, 'list');
          var hit = l.rows.filter(function (x) { return str(x.stk_cd).toUpperCase() === t; })[0] || l.rows[0];
          var ex = hit ? str(hit.stex_tp).toUpperCase() : '';
          return EX[ex] ? ex : '';
        } catch (e) {
          if (e.fatal) throw e;
          return '';
        }
      }

      var list = Array.isArray(items) ? items : [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        try {
          if (it.market === 'KR') {
            var r = await call(cfg, ctx, '/api/dostk/stkinfo', 'ka10001', { stk_cd: krCode(it.code) }, null);
            var p = abs(r.head.cur_prc);
            if (p > 0) out[it.key] = { price: p };
          } else if (it.market === 'US') {
            var t = str(it.code).toUpperCase();
            if (!t) continue;
            var tried = {}, found = '', price = 0;
            var order = [exMap[t], null, 'ND', 'NY', 'NA'];   // null 자리에서 거래소를 물어봐요
            for (var j = 0; j < order.length && !found; j++) {
              var ex = order[j] === null ? await lookupEx(t) : order[j];
              if (!ex || !EX[ex] || tried[ex]) continue;
              tried[ex] = 1;
              price = await usPrice(t, ex);
              if (price > 0) found = ex;
            }
            if (found) {
              out[it.key] = { price: price, ex: EX[found] };
              if (exMap[t] !== found) { exMap[t] = found; dirty = true; }
            }
          }
        } catch (e) {
          if (e.fatal) throw e;   // IP·키 문제는 바로 알려요. 그 밖의 종목 하나 실패는 건너뛰어요
        }
      }
      if (dirty) save(cfg, ctx);
      return out;
    }
  });
})();
