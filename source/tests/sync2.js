const fs=require('fs');
const [htmlPath, workerPath]=process.argv.slice(2);
const html=fs.readFileSync(htmlPath,'utf8');
let code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
code=code.replace("https://moa-sync.moa-sync.workers.dev/v1/","https://moa-sync.test.workers.dev/v1/");
// fake Cloudflare KV + worker
const store=new Map(); const env={MOA_SYNC:{async get(k,t){const v=store.get(k); return v==null?null:(t==='json'?JSON.parse(v):v);}, async put(k,v){store.set(k,v);}, async delete(k){store.delete(k);}}};
// 워커는 ES 모듈이라 import/export 줄을 걷어내고 함수로 불러요. 알림함(inbox)은 이 시험에서 안 써요.
const worker=new Function(fs.readFileSync(workerPath,'utf8').replace(/^import .*$/gm,'').replace(/^export {[^}]*}.*$/gm,'').replace('export default','const handleInbox=async()=>new Response("",{status:404});return'))();
const fakeFetch=async(url,opt={})=>worker.fetch(new Request(url,opt),env);
function device(name){
  const ls=new Map(); const localStorage={getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)};
  const els={}; const mk=()=>new Proxy({innerHTML:'',hidden:false,value:'',textContent:'',dataset:{},style:{},clientWidth:600,classList:{add(){},remove(){}}},{get(t,k){ if(k in t) return t[k]; if(k==='querySelector') return ()=>mk(); if(k==='querySelectorAll') return ()=>[]; if(k==='closest') return ()=>null; return ()=>mk(); }, set(t,k,v){t[k]=v; return true;}});
  const document={querySelector:s=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],addEventListener(){},createElement:()=>mk(),head:mk(),visibilityState:'visible'};
  const window={__MOA_TEST__:true,addEventListener(){},crypto:globalThis.crypto};
  const location={hash:'',pathname:'/moa-money/household/',search:'',hostname:'converseddululu.github.io',origin:'https://converseddululu.github.io'};
  const history={replaceState(a,b,u){ location.hash=(u.match(/#.*/)||[''])[0]; }};
  const api=new Function('localStorage','document','window','location','history','fetch', code+`
    return { S, loadWS, save, FORMS, syncEnable, handleSyncHash, syncPush, syncPull, get SY(){return SY;}, location };`)(localStorage,document,window,location,history,fakeFetch);
  return api;
}
const memos=d=>d.S.d.tx.map(t=>t.memo).sort().join(', ');
(async()=>{
  const A=device('A'), B=device('B');
  A.loadWS('mine'); A.FORMS.tx({id:'',date:'2026-11-10',type:'out',cat:'',memo:'김밥천국',amount:'9,000',method:'카드'}); A.save();
  await A.syncEnable(); console.log('A sync', A.SY.status, 'v', A.SY.v, '| link key length', A.SY.key.length);
  const stored=[...store.values()][0]; console.log('server holds plaintext?', /김밥/.test(stored) ? 'YES (bad)' : 'no (encrypted)');
  // B joins via link (empty device)
  B.location.hash='#sync='+A.SY.key; await B.handleSyncHash(); console.log('B after join:', memos(B), '| B status', B.SY.status, 'v', B.SY.v);
  // B adds one, deletes 김밥천국
  B.FORMS.tx({id:'',date:'2026-11-11',type:'out',cat:'',memo:'스타벅스',amount:'6,100',method:'카드'});
  const kid=B.S.d.tx.find(t=>t.memo==='김밥천국').id; B.S.d.tx=B.S.d.tx.filter(t=>t.id!==kid); B.save(); await B.syncPush(); console.log('B pushed v', B.SY.v);
  // A edits offline (no pull) then pushes -> conflict -> merge
  A.FORMS.tx({id:'',date:'2026-11-12',type:'out',cat:'',memo:'쿠팡이츠',amount:'23,400',method:'카드'}); A.save(); await A.syncPush();
  console.log('A after conflict merge:', memos(A), '| v', A.SY.v, A.SY.status);
  await B.syncPull(); console.log('B after pull:', memos(B), '| v', B.SY.v);
  // profile change on B wins
  B.FORMS.profile({name:'민수',payday:'21',income:'3,500,000',budget:'1,500,000'}); B.save(); await B.syncPush(); await A.syncPull(); console.log('A profile:', A.S.d.profile.name, A.S.d.profile.payday);
  // wrong key cannot read
  const C=device('C'); C.loadWS('mine'); C.location.hash='#sync='+A.SY.key.replace(/^./, c=>c==='A'?'B':'A'); await C.handleSyncHash(); console.log('C with wrong key has data?', C.S.d.tx.length ? 'YES (bad)' : 'no');
  // forged write without token
  const r=await fakeFetch('https://moa-sync.test.workers.dev/v1/'+A.SY.id,{method:'PUT',headers:{'X-Write-Token':'x'.repeat(30),'Content-Type':'application/json'},body:JSON.stringify({base:A.SY.v,iv:'a',data:'b'})}); console.log('forged write status', r.status);
  process.exit(0);
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });
