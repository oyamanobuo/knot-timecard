// KNOT TIME CARD v1 - Cloudflare Worker sample
// IMPORTANT: replace DEMO_* values and use a real KV/D1 database before production.
// This sample demonstrates server-side IP restriction and PIN authentication.

const STORE_IPS = ["27.121.145.216"];
const EMPLOYEES = {
  tanaka: {name:"田中", pin:"1234"},
  sato:   {name:"佐藤", pin:"2345"},
  yamada: {name:"山田", pin:"3456"},
  oyama:  {name:"大山", pin:"4567"}
};

// Demo in-memory logs reset when the Worker instance changes.
// Production should use Cloudflare D1/KV or another database.
const logs = [];

function getClientIP(request){
  return request.headers.get("CF-Connecting-IP") || "";
}
function cors(){
  return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
}
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json",...cors()}});
}
function tokenFor(id){return btoa(id+"|knot-v1");}
function idFromToken(t){
  try { const s=atob(t.replace("Bearer ","")); return s.endsWith("|knot-v1")?s.split("|")[0]:null; }
  catch(e){return null}
}
function allowed(request){ return STORE_IPS.includes(getClientIP(request)); }

export default {
 async fetch(request, env){
   if(request.method==="OPTIONS") return new Response("",{headers:cors()});
   const url=new URL(request.url);

   // All API operations require the store network.
   if(url.pathname.startsWith("/api/") && !allowed(request)){
     return json({ok:false,message:"店舗Wi‑Fiからアクセスしてください。",clientIP:getClientIP(request)},403);
   }

   if(url.pathname==="/api/network") return json({allowed:true,clientIP:getClientIP(request)});

   if(url.pathname==="/api/auth" && request.method==="POST"){
     const b=await request.json();
     const e=EMPLOYEES[b.employeeId];
     if(!e || e.pin!==String(b.pin)) return json({ok:false,message:"PINが違います"},401);
     return json({ok:true,token:tokenFor(b.employeeId)});
   }

   if(url.pathname==="/api/status"){
     const id=idFromToken(request.headers.get("Authorization")||"");
     if(!id) return json({ok:false,message:"認証が必要です"},401);
     const today=new Date().toLocaleDateString("ja-JP",{timeZone:"Asia/Tokyo"});
     const mine=logs.filter(x=>x.employeeId===id && x.date===today);
     return json({ok:true,status:mine.length%2?"working":"off",logs:mine.map(x=>({type:x.type,time:x.time}))});
   }

   if(url.pathname==="/api/punch" && request.method==="POST"){
     const id=idFromToken(request.headers.get("Authorization")||"");
     if(!id || !EMPLOYEES[id]) return json({ok:false,message:"認証が必要です"},401);
     const now=new Date();
     const date=now.toLocaleDateString("ja-JP",{timeZone:"Asia/Tokyo"});
     const time=now.toLocaleTimeString("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",second:"2-digit"});
     const mine=logs.filter(x=>x.employeeId===id && x.date===date);
     const type=mine.length%2?"out":"in";
     logs.push({employeeId:id,date,time,type,ip:getClientIP(request),createdAt:now.toISOString()});
     return json({ok:true,type,time});
   }
   return new Response("KNOT TIME CARD v1");
 }
}