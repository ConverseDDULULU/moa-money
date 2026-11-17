const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const code=scripts[scripts.length-1];
global.window={__LEDGER_TEST__:true,addEventListener(){}}; global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
global.document={querySelector(){return null},querySelectorAll(){return []},addEventListener(){}};
global.location={hash:''};
const stub={addEventListener(){}};
const run=new Function('STUB', code.replace(/\$\('#inv-cancel'\)\.addEventListener/,'STUB.addEventListener').replace(/\$\('#inv-form'\)\.addEventListener/,'STUB.addEventListener')+`
;window.addEventListener=()=>{};
loadWS('sample');
const c=compute();
const out={};
for(const m of c.months){const p=pl(m); out[m]={rev:man(p.revT),exp:man(p.expT),profit:man(p.revT-p.expT),unBank:p.unBank.length};}
console.log('months',c.months.join(','),'asOf',c.asOf);
console.table(out);
console.log('rev Oct', JSON.stringify([...pl('2026-10').rev].map(([k,v])=>[k,man(v)])));
console.log('exp Oct', JSON.stringify([...pl('2026-10').exp].map(([k,v])=>[k,man(v)])));
console.log('recv', c.recv.length, man(c.recv.reduce((s,r)=>s+r.rem,0)), c.recv.map(r=>r.partner+':'+r.days+'d').join(' | '));
console.log('unapplied', JSON.stringify(c.unapplied));
console.log('pending', c.pending.map(p=>p.group+':'+p.pname+':'+p.date).join(' | '));
// min balance per account
const mn={}; for(const t of c.bank){ mn[t.acct]=Math.min(mn[t.acct]??Infinity,t.bal);} console.log('min bal', JSON.stringify(Object.fromEntries(Object.entries(mn).map(([k,v])=>[k,man(v)]))));
console.log('Oct close', acctMonth('2026-10').map(r=>r.a.name+' '+man(r.close)).join(' / '));
// journal balance for all days
let bad=0, miss=0; const days=[...new Set(c.bank.map(t=>t.date))];
for(const d of days){const J=journal(c.bank.filter(t=>t.date===d)); const dr=J.filter(l=>l.side==='차변').reduce((s,l)=>s+l.amt,0), cr=J.filter(l=>l.side==='대변').reduce((s,l)=>s+l.amt,0); if(dr!==cr) bad++; miss+=J.filter(l=>l.missing).length;}
console.log('journal days',days.length,'unbalanced',bad,'missing lines',miss);
console.log('bank tx',c.bank.length,'card',c.card.length,'inv',c.inv.length);
// fund rows check
const fr=fundRows('2026-10-30'); console.log('fund 10/30 close', man(fr.close), 'acctMonth Oct close', man(acctMonth('2026-10').reduce((s,r)=>s+r.close,0)));
// parse test: bank csv-like rows
const rows=[['OO은행 거래내역'],[''],['거래일시','적요','기재내용','찾으신금액','맡기신금액','거래후잔액','거래점'],['2026.09.30 15:10:22','타행이체','미래패키징','0','28,600,000','140,000,000','본점'],['2026.09.29 10:00:00','자동이체','삼성화재','480,000','0','111,400,000','']];
const r=parseUpload('bank',rows); console.log('parse bank', JSON.stringify(r.map), r.rows.length, r.rows[0].date, r.opening);
const hrows=[['전자세금계산서 목록'],['작성일자','승인번호','발급일자','공급자사업자등록번호','상호','대표자명','공급받는자사업자등록번호','상호','대표자명','합계금액','공급가액','세액','품목명'],['2026-10-02','2026100241000011','2026-10-02','134-81-11111','(주)우리','홍길동','222-81-22222','(주)미래패키징','김대표','33,000,000','30,000,000','3,000,000','베어링 하우징']];
const h=parseUpload('S',hrows); console.log('parse inv', JSON.stringify(h.map), JSON.stringify(h.rows[0]));
`);
run(stub);
