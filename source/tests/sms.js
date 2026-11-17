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
const show = items => items.forEach(i=>console.log(' ', i.status.padEnd(12), i.date, '|', i.memo, '|', i.type, i.amount, '|', i.cat, '|', i.method));
console.log('== 예시 문자'); show(readSms(SMS_EXAMPLE));
const more = \`[Web발신]
삼성1234승인 김*수
32,000원 일시불
11/13 20:11 교보문고
누적1,120,000원
[Web발신]
롯데카드 승인 김*수 15,800원 일시불 11/12 12:30 하나로마트 양재점 누적300,000원
[Web발신]
하나(5678)김*수님 11/12 13:05 일시불 9,000원 김밥천국
[Web발신]
우리(9012)승인 김*수님 120,000원 03개월 11/11 17:40 다이슨코리아 누적620,000원
[Web발신]
NH카드1*2*승인 김*수 4,500원 일시불 11/10 09:00 메가MGC커피 총누적80,000원
[Web발신]
BC카드(3456)체크승인 김*수 11,200원 11/09 21:10 GS25 역삼점 잔액250,000원
[Web발신]
[신한] 11/08 09:30 110-***-123456 출금 300,000 키움증권 잔액 1,500,000
신한카드 이벤트 안내: 이번 달 혜택을 확인하세요\`;
console.log('== 다른 카드사'); show(readSms(more));
console.log('== 한 줄씩 붙여넣기 (빈 줄 없음)'); show(readSms(SMS_EXAMPLE.split(String.fromCharCode(10)).filter(l=>l.trim()).join(String.fromCharCode(10))));
// existing tx cancel match: take the sample's 쿠팡 32,800 entries
const T=today(); const cp=S.d.tx.find(t=>t.memo==='쿠팡'&&t.amount===32800);
const canc = "[Web발신] 현대카드 승인취소 김*수 32,800원 "+cp.date.slice(5).replace('-','/')+' 21:00 쿠팡';
console.log('== 기존 결제 취소'); show(readSms(canc));
// duplicate paste: commit then read again
const before=S.d.tx.length; S.sms=readSms(SMS_EXAMPLE); commitSms(); console.log('committed', S.d.tx.length-before, 'tx');
console.log('== 같은 문자 다시'); show(readSms(SMS_EXAMPLE));
S.tab='ledger'; S.smsText=SMS_EXAMPLE; S.sms=readSms(SMS_EXAMPLE); render(); const h=document.querySelector('#v-ledger').innerHTML; console.log('ledger view', h.length, /undefined|NaN/.test(h.replace(/(data-[a-z]+|value|placeholder)="[^"]*"/g,''))?'HAS undefined/NaN':'ok', h.includes('sms-commit'));
`)();
