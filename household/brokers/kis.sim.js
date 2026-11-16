// 한국투자증권 샘플 응답 (시뮬레이션용, 예시 숫자). 네트워크를 쓰지 않아요.
// 본체가 '샘플로 해 보기'를 누르면 fetch를 잠깐 이 함수로 돌려서, 진짜 kis.js를 그대로 실행해요.
// 응답 모양은 한국투자 공식 예제(examples_llm)의 항목 이름과 같아요.
(function () {
  window.MoaBrokerSim = window.MoaBrokerSim || {};
  const J = (o, h = {}) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...h } });
  const today = () => { const t = new Date(); return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`; };
  const notAfterToday = d => (d > today() ? today() : d);
  const KR = [
    ['005930', '삼성전자', 15, 61800, 81200], ['000660', 'SK하이닉스', 3, 172000, 214500],
    ['069500', 'KODEX 200', 40, 33950, 41250], ['360750', 'TIGER 미국S&P500', 25, 19880, 23840]
  ];
  const US = [['AAPL', '애플', 12, 198.4, 236.4, 'NASD'], ['MSFT', '마이크로소프트', 5, 405.1, 448.3, 'NASD'], ['VOO', '뱅가드 S&P500 ETF', 4, 512.0, 571.8, 'AMEX']];
  const krRow = ([code, name, q, avg, now]) => ({ pdno: code, prdt_name: name, hldg_qty: String(q), pchs_avg_pric: avg.toFixed(4), pchs_amt: String(q * avg), prpr: String(now), evlu_amt: String(q * now), evlu_pfls_amt: String(q * (now - avg)), evlu_pfls_rt: (((now - avg) / avg) * 100).toFixed(2) });
  const usRow = ([sym, name, q, avg, now, ex]) => ({ ovrs_pdno: sym, ovrs_item_name: name, ovrs_cblc_qty: String(q), pchs_avg_pric: avg.toFixed(4), now_pric2: now.toFixed(6), ovrs_stck_evlu_amt: (q * now).toFixed(2), frcr_evlu_pfls_amt: (q * (now - avg)).toFixed(2), ovrs_excg_cd: ex, tr_crcy_cd: 'USD' });
  const KR_PRICE = { '005930': '81500', '277810': '199000', '069500': '41300', '360750': '23900', '000660': '214500' };
  const US_PRICE = { 'NAS:NVDA': '188.4', 'NAS:TSLA': '351.2', 'NAS:QQQ': '613.1', 'NYS:SCHD': '29.71', 'NAS:AAPL': '236.4', 'NAS:MSFT': '448.3', 'AMS:VOO': '571.8' };

  window.MoaBrokerSim.kis = async function (url, init) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!u.pathname.startsWith('/kis/')) return null;
    if (u.pathname === '/kis/token') return J({ access_token: 'SAMPLE-ACCESS-TOKEN', token_type: 'Bearer', expires_in: 86400, access_token_token_expired: '' });
    const h = (init && init.headers) || {}, tr = h.tr_id || (h.get && h.get('tr_id')), q = u.searchParams;
    if (tr === 'TTTC8434R') {
      if (!q.get('CTX_AREA_FK100')) return J({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', ctx_area_fk100: 'SAMPLEFK', ctx_area_nk100: 'SAMPLENK', output1: KR.slice(0, 2).map(krRow), output2: [{}] }, { tr_cont: 'M' });
      return J({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.', ctx_area_fk100: '', ctx_area_nk100: '', output1: KR.slice(2).map(krRow), output2: [{}] }, { tr_cont: 'D' });
    }
    if (tr === 'TTTS3012R') return J({ rt_cd: '0', msg1: '정상처리 되었습니다.', ctx_area_fk200: '', ctx_area_nk200: '', output1: US.map(usRow), output2: {} }, { tr_cont: 'D' });
    if (tr === 'TTTS3039R') {
      const y = q.get('INQR_STRT_DT').slice(0, 4), y0 = today().slice(0, 4);
      const rows = y === y0
        ? [{ trad_day: notAfterToday(`${y}0305`), ovrs_pdno: 'AMD', ovrs_item_name: 'AMD', slcl_qty: '15', pchs_avg_pric: '98.3000', avg_sll_unpr: '242.4000', ovrs_rlzt_pfls_amt: '3120000', exrt: '1452.10', ovrs_excg_cd: 'NASD' },
           { trad_day: notAfterToday(`${y}0721`), ovrs_pdno: 'GOOGL', ovrs_item_name: '알파벳 A', slcl_qty: '6', pchs_avg_pric: '205.0000', avg_sll_unpr: '183.5000', ovrs_rlzt_pfls_amt: '-184300', exrt: '1388.50', ovrs_excg_cd: 'NASD' }]
        : [{ trad_day: `${y}1112`, ovrs_pdno: 'AMZN', ovrs_item_name: '아마존', slcl_qty: '8', pchs_avg_pric: '178.2000', avg_sll_unpr: '211.6000', ovrs_rlzt_pfls_amt: '392500', exrt: '1462.30', ovrs_excg_cd: 'NASD' }];
      return J({ rt_cd: '0', msg1: '정상처리 되었습니다.', ctx_area_fk200: '', ctx_area_nk200: '', output1: rows, output2: {} }, { tr_cont: 'D' });
    }
    if (tr === 'FHKST01010100') { const c = q.get('FID_INPUT_ISCD'); return J({ rt_cd: '0', msg1: '정상처리 되었습니다.', output: { stck_prpr: KR_PRICE[c] || String(10000 + (Number(String(c).replace(/\D/g, '')) % 90000)) } }); }
    if (tr === 'HHDFS00000300') return J({ rt_cd: '0', msg1: '정상처리 되었습니다.', output: { rsym: '', last: US_PRICE[q.get('EXCD') + ':' + q.get('SYMB')] || '' } });
    return J({ rt_cd: '1', msg_cd: 'SIM404', msg1: '샘플에 없는 요청이에요' });
  };
})();
