const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
const mk=()=>new Proxy({innerHTML:'',hidden:false,value:'',textContent:'',dataset:{},style:{},clientWidth:600,classList:{add(){},remove(){}}},{get(t,k){ if(k in t) return t[k]; if(k==='querySelector') return ()=>mk(); if(k==='querySelectorAll') return ()=>[]; if (k==='closest') return ()=>null; return ()=>mk(); }, set(t,k,v){t[k]=v; return true;}});
const els={};
global.window={__MOA_TEST__:true,addEventListener(){}};
global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
global.document={querySelector:(s)=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],addEventListener(){}};
global.location={hash:''};
new Function(code+`
loadWS('sample');
const T=today(); console.log('today',T,'months',months().join(','));
for (const m of months()){ const s=monthStats(m); console.log(m,'in',won(s.inn),'out',won(s.out),'save',won(s.save),'left',won(s.left),'n',s.n); }
const fs_=fixedSummary(); console.log('fixed monthly cost',won(fs_.mCost),'save',won(fs_.mSave),'year',won(fs_.yCost),'subs',won(fs_.subs));
const p=paydayInfo(); console.log('payday',p.next,'days',p.days,'bal',won(p.bal),'remain',won(p.remain),'avail',won(p.avail),'perDay',won(p.perDay), p.list.map(x=>x.d+' '+x.f.name).join(' | '));
console.log('dups',dups(T.slice(0,7)).map(([a,b])=>a.memo+a.amount+' '+a.date+'/'+b.date).join(';'));
console.log('priceUps',JSON.stringify(priceUps(T.slice(0,7))));
for (const s of S.d.savings){ const c=savCalc(s); console.log('sav',s.name,s.kind,'start',s.start,'end',c.end,'dday',c.dday,'paid',won(c.paid),'paidN',c.paidN,'int',won(c.interest),'tax',won(c.tax),'total',won(c.total)); }
// formula checks
console.log('check 적금 50만 3.8% 24m 단리 이자 =', won(500000*0.038/12*24*25), ' 예금 1000만 3.2% 12m =', won(10000000*0.032));
for (const m of ['avg','fifo']){ S.d.settings.costMethod=m; const b=book(); const t=taxFor(b.realized,2026); console.log(m,'US net',won(t.net),'gain',won(t.gainSum),'loss',won(t.lossSum),'base',won(t.base),'cgt',won(t.cgt),'local',won(t.local),'total',won(t.total),'stt',won(t.stt),'etfTax',won(t.etfTax)); console.log(' realized', b.realized.map(r=>r.name+':'+won(r.gain)).join(' | ')); console.log(' holdings', b.holdings.map(h=>h.name+' '+(+h.qty.toFixed(3))+'주 avg '+won(h.avg)+' val '+won(h.value)+' pl '+won(h.pl)).join(' | ')); }
S.d.settings.costMethod='avg';
(async()=>{ const a=await fetchFx("latest"); const b=await fetchFx("2026-03-07"); console.log("fx latest",JSON.stringify(a),"| 3/7(토)",JSON.stringify(b)); await refreshFx(false); console.log("after refresh", JSON.stringify(S.d.settings), "| note:", fxNote()); S.tab="stocks"; render(); console.log("stocks view has button", document.querySelector("#v-stocks").innerHTML.includes("fx-latest"), "trade btn", document.querySelector("#v-stocks").innerHTML.includes("fx-trade")); })();
const sim=simulate('NVDA',5); console.log('sim NVDA 5', sim && won(sim.r.gain), sim && won(sim.extra));
const sim2=simulate('005930',5); console.log('sim 삼성 5', sim2 && sim2.kind, won(sim2.extra));
const nw=netWorth(); console.log('networth',won(nw.net),'bank',won(nw.bank),'sav',won(nw.sav),'stock',won(nw.stock),'loan',won(nw.loan));
for (const v of VIEWS){ S.tab=v; render(); const h=document.querySelector('#v-'+v).innerHTML; console.log('view',v,h.length, /undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder)="[^"]*"/g,''))?'HAS undefined/NaN':'ok'); }
S.edit={kind:'trade',obj:S.d.trades[0]}; S.tab='stocks'; render(); console.log('edit trade ok');
S.simKey='NVDA'; S.simQty='5'; render(); console.log('sim view ok');
loadWS('mine'); for (const v of VIEWS){ S.tab=v; render(); console.log('mine',v,'ok'); }
// upload parse
const rows=[['카드 이용내역'],['이용일','이용가맹점','이용금액'],['2026.11.02','스타벅스 강남점','6,100'],['2026.11.03','넷플릭스','17,000'],['2026.11.04','쿠팡이츠','23,400']];
console.log(JSON.stringify(parseRows(rows).rows.map(r=>r.cat)));
const brow=[['거래일시','적요','기재내용','출금액','입금액','잔액'],['2026-11-05 09:00','이체','OO증권','300,000','0','1,000,000'],['2026-11-25','급여','(주)OO','0','3,800,000','4,800,000']];
console.log(JSON.stringify(parseRows(brow).rows.map(r=>r.type+':'+r.cat)));
`)();
