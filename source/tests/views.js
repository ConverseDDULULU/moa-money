const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).pop();
const mk=()=>new Proxy({innerHTML:'',hidden:false,value:'',textContent:'',dataset:{},style:{},clientWidth:600,offsetWidth:140},{get(t,k){ if(k in t) return t[k]; if(k==='querySelector') return ()=>mk(); if(k==='querySelectorAll') return ()=>[]; if(k==='getBoundingClientRect') return ()=>({left:0,top:0,width:600,height:220}); return ()=>mk(); }, set(t,k,v){t[k]=v; return true;}});
const els={};
global.window={__LEDGER_TEST__:true,addEventListener(){}};
global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
global.document={querySelector:(s)=>els[s]||(els[s]=mk()),querySelectorAll:()=>[],addEventListener(){}};
global.location={hash:''}; global.CSS={escape:s=>s};
new Function(code+`
loadWS('sample');
for (const v of VIEWS){ S.tab=v; render(); const h=document.querySelector('#v-'+v).innerHTML; console.log(v, 'html chars', h.length, /undefined|NaN/.test(h.replace(/data-[a-z]+="[^"]*"/g,'')) ? 'HAS undefined/NaN' : 'ok'); }
S.tab='dashboard'; S.revFilter='가공부품'; S.expTab='card'; render(); console.log('drill ok', document.querySelector('#v-dashboard').innerHTML.length);
S.ws='mine'; S.data=emptyMine(); S.rules={}; S.ovr={}; bump(); for (const v of VIEWS){ S.tab=v; render(); console.log('mine-empty', v, 'ok'); }
const chart=document.querySelector('#bal-chart').innerHTML; console.log('chart svg', /<svg/.test(chart));
`)();
