const STORE_IPV4 = "27.121.145.216";
const STORE_IPV6_PREFIX = "2001:f70:9160:600:";

const EMPLOYEES = {
  tanaka: { name: "田中", pin: "1234" },
  sato:   { name: "佐藤", pin: "2345" },
  yamada: { name: "山田", pin: "3456" },
  oyama:  { name: "大山", pin: "4567" },
};

function clientIp(request) { return request.headers.get("CF-Connecting-IP") || ""; }
function allowedIp(ip) { return ip === STORE_IPV4 || ip.startsWith(STORE_IPV6_PREFIX); }
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" } });
}
async function readJson(request) { try { return await request.json(); } catch { return null; } }
function dbRequired(env) { return env.DB && typeof env.DB.prepare === "function"; }

async function getEmployees(env) {
  if (!dbRequired(env)) return Object.entries(EMPLOYEES).map(([id,e]) => ({id,name:e.name}));
  const r = await env.DB.prepare("SELECT id,name FROM employees WHERE active=1 ORDER BY id").all();
  return r.results || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = clientIp(request);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/network" && request.method === "GET") {
        return json({ ok:true, allowed:allowedIp(ip), clientIp:ip });
      }

      if (!allowedIp(ip)) return json({ ok:false, message:"店舗ネットワークからのみ利用できます。" }, 403);

      if (url.pathname === "/api/status" && request.method === "GET") {
        if (!dbRequired(env)) return json({ ok:true, version:"1.2", database:false, message:"D1未接続です。" });
        const r = await env.DB.prepare("SELECT COUNT(*) AS count FROM punches").first();
        return json({ ok:true, version:"1.2", database:true, punchCount:r?.count || 0 });
      }

      if (url.pathname === "/api/employees" && request.method === "GET") {
        try { return json({ok:true, employees:await getEmployees(env)}); }
        catch(e) { return json({ok:false,message:"スタッフ取得エラー: "+e.message},500); }
      }

      if (url.pathname === "/api/auth" && request.method === "POST") {
        const body = await readJson(request);
        if (!body?.employeeId || !/^\d{4}$/.test(body.pin || "")) return json({ok:false,message:"PINが違います。"},401);
        if (dbRequired(env)) {
          const emp = await env.DB.prepare("SELECT id,name FROM employees WHERE id=? AND pin=? AND active=1").bind(body.employeeId, body.pin).first();
          if (!emp) return json({ok:false,message:"PINが違います。"},401);
          return json({ok:true,employeeId:emp.id,name:emp.name});
        }
        const emp=EMPLOYEES[body.employeeId];
        if (!emp || body.pin!==emp.pin) return json({ok:false,message:"PINが違います。"},401);
        return json({ok:true,employeeId:body.employeeId,name:emp.name});
      }

      if (url.pathname === "/api/punch" && request.method === "POST") {
        const body = await readJson(request);
        if (!body?.employeeId) return json({ok:false,message:"スタッフが指定されていません。"},400);
        if (!dbRequired(env)) return json({ok:false,message:"D1が未接続です。"},503);
        const emp = await env.DB.prepare("SELECT id,name FROM employees WHERE id=? AND active=1").bind(body.employeeId).first();
        if (!emp) return json({ok:false,message:"スタッフが見つかりません。"},400);
        const last = await env.DB.prepare("SELECT type,timestamp FROM punches WHERE employee_id=? ORDER BY id DESC LIMIT 1").bind(emp.id).first();
        const type = last?.type === "in" ? "out" : "in";
        const timestamp = new Date().toISOString();
        await env.DB.prepare("INSERT INTO punches (employee_id,name,type,timestamp,client_ip) VALUES (?,?,?,?,?)").bind(emp.id,emp.name,type,timestamp,ip).run();
        return json({ok:true,type,timestamp,employeeId:emp.id});
      }

      if (url.pathname === "/api/history" && request.method === "GET") {
        if (!dbRequired(env)) return json({ok:false,message:"D1が未接続です。"},503);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")||30),1),200);
        const employeeId = url.searchParams.get("employeeId");
        const sql = employeeId
          ? "SELECT id,employee_id,name,type,timestamp,client_ip FROM punches WHERE employee_id=? ORDER BY id DESC LIMIT ?"
          : "SELECT id,employee_id,name,type,timestamp,client_ip FROM punches ORDER BY id DESC LIMIT ?";
        const r = employeeId ? await env.DB.prepare(sql).bind(employeeId,limit).all() : await env.DB.prepare(sql).bind(limit).all();
        return json({ok:true,rows:r.results||[]});
      }

      return json({ok:false,message:"Not Found"},404);
    }
    return env.ASSETS.fetch(request);
  }
};
