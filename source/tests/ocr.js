const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
const mk=()=>new Proxy({innerHTML:'',hidden:false,value:'',textContent:'',dataset:{},style:{},clientWidth:600,classList:{add(){},remove(){}}},{get(t,k){ if(k in t) return t[k]; if(k==='querySelector') return ()=>mk(); if(k==='querySelectorAll') return ()=>[]; if (k==='closest') return ()=>null; return ()=>mk(); }, set(t,k,v){t[k]=v; return true;}});
const els={};
global.window={__MOA_TEST__:true,addEventListener(){}};
global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
global.document={querySelector:(s)=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],addEventListener(){}};
global.location={hash:''}; global.history={replaceState(){}};
const cases = {
 '토스식 (날짜 묶음 + 잔액 줄, 음절 사이 공백)': `11월 14일
스 타 벅 스 역 삼 점 -6,100원
08:42 1,858,100원
쿠 팡 이 츠 -23,400원
19:05 1,834,700원
11월 13¢
김 민 수 +45,000원
12:10 1,858,100원
키움증권 -300,000원
09:30 1,813,100원`,
 'KB식 (날짜시간 줄 + 가게 줄 + 출금 줄)': `2026.11.14 08:42:11
스타벅스역삼점
출금 6,100원
잔액 1,858,100원
2026.11.12 12:30:02
(주)OO 급여
입금 3,800,000원
잔액 5,000,000원`,
 '카드앱식 (부호 없음, 일시불)': `11.14 (금)
교보문고 32,000원
일시불 | 신한카드
11.13 (목)
배달의민족 18,900원
일시불 | 신한카드
11.12 (수)
무신사 48,900원 취소`,
 '잡음 (계좌번호·전화번호·연도)': `계좌 110-123-456789
고객센터 1588-8000
2026년 11월 거래내역
총 3건`
};
new Function(code+`
loadWS('sample');
const cs=${JSON.stringify(cases)};
for (const [k,v] of Object.entries(cs)){ console.log('== '+k); for (const i of markStatus(parseOcr(v))) console.log('  ', i.status.padEnd(10), i.date, '|', i.memo, '|', i.type+(i.unsure?'(?)':''), i.amount, '|', i.cat); }
S.tab='ledger'; S.smsSrc='ocr'; S.sms=markStatus(parseOcr(cs[Object.keys(cs)[2]])); S.sms[0].skip=true; render(); const h=document.querySelector('#v-ledger').innerHTML; console.log('ledger view', /undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder|id|for)="[^"]*"/g,''))?'HAS undefined/NaN':'ok', 'commit label:', (h.match(/data-act="sms-commit"[^>]*>([^<]+)/)||[])[1]);
S.tab='home'; render(); console.log('home quick', document.querySelector('#v-home').innerHTML.includes('ocr-file-home'));
`)();
