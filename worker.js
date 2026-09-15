const STORE_IPV4 = "27.121.145.216";
const STORE_IPV6_PREFIX = "2001:f70:9160:600:";
const ADMIN_PIN = "9999"; // V1.3.2 test admin PIN. Change before production.

const EMPLOYEES = {
  tanaka: { name: "田中", pin: "1234" },
  sato:   { name: "佐藤", pin: "2345" },
  yamada: { name: "山田", pin: "3456" },
  oyama:  { name: "大山", pin: "4567" },
};

function clientIp(request) { return request.headers.get("CF-Connecting-IP") || ""; }
function allowedIp(ip) { return ip === STORE_IPV4 || ip.startsWith(STORE_IPV6_PREFIX); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
async function readJson(request) { try { return await request.json(); } catch { return null; } }
function dbRequired(env) { return env.DB && typeof env.DB.prepare === "function"; }

async function ensureSchema(env) {
  if (!dbRequired(env)) return false;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL,
    hourly_wage INTEGER NOT NULL DEFAULT 0, transport_allowance INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id TEXT NOT NULL, name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('in','out')), timestamp TEXT NOT NULL,
    client_ip TEXT, source TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS punch_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, punch_id INTEGER, employee_id TEXT NOT NULL,
    old_type TEXT, old_timestamp TEXT, new_type TEXT, new_timestamp TEXT,
    reason TEXT NOT NULL, edited_by TEXT NOT NULL, edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_punches_employee_time ON punches(employee_id, timestamp)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_punches_time ON punches(timestamp)`).run();
  for (const [id, emp] of Object.entries(EMPLOYEES)) {
    await env.DB.prepare(`INSERT OR IGNORE INTO employees (id,name,pin) VALUES (?,?,?)`).bind(id, emp.name, emp.pin).run();
  }
  return true;
}

function adminOk(body) {
  return body?.adminPin === ADMIN_PIN;
}

async function getEmployees(env, includePrivate = false) {
  await ensureSchema(env);
  const cols = includePrivate ? "id,name,pin,hourly_wage,transport_allowance,active" : "id,name";
  const r = await env.DB.prepare(`SELECT ${cols} FROM employees WHERE active=1 ORDER BY id`).all();
  return r.results || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = clientIp(request);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/network" && request.method === "GET") return json({ ok: true, allowed: allowedIp(ip), clientIp: ip });
      if (!allowedIp(ip)) return json({ ok: false, message: "店舗ネットワークからのみ利用できます。" }, 403);

      if (url.pathname === "/api/status" && request.method === "GET") {
        try {
          if (!dbRequired(env)) return json({ ok: true, version: "1.4", database: false, message: "D1未接続です。" });
          await ensureSchema(env);
          const r = await env.DB.prepare("SELECT COUNT(*) AS count FROM punches").first();
          const e = await env.DB.prepare("SELECT COUNT(*) AS count FROM employees WHERE active=1").first();
          return json({ ok: true, version: "1.4", database: true, punchCount: Number(r?.count || 0), employeeCount: Number(e?.count || 0), schema: "ready" });
        } catch (e) { return json({ ok: false, message: "D1初期化エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/employees" && request.method === "GET") {
        try { return json({ ok: true, employees: await getEmployees(env) }); }
        catch (e) { return json({ ok: false, message: "スタッフ取得エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/auth" && request.method === "POST") {
        try {
          await ensureSchema(env); const body = await readJson(request);
          if (!body?.employeeId || !/^\d{4}$/.test(body.pin || "")) return json({ ok: false, message: "PINが違います。" }, 401);
          const emp = await env.DB.prepare("SELECT id,name FROM employees WHERE id=? AND pin=? AND active=1").bind(body.employeeId, body.pin).first();
          if (!emp) return json({ ok: false, message: "PINが違います。" }, 401);
          return json({ ok: true, employeeId: emp.id, name: emp.name });
        } catch (e) { return json({ ok: false, message: "認証エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/punch" && request.method === "POST") {
        try {
          await ensureSchema(env); const body = await readJson(request);
          if (!body?.employeeId) return json({ ok: false, message: "スタッフが指定されていません。" }, 400);
          const emp = await env.DB.prepare("SELECT id,name FROM employees WHERE id=? AND active=1").bind(body.employeeId).first();
          if (!emp) return json({ ok: false, message: "スタッフが見つかりません。" }, 400);
          const last = await env.DB.prepare("SELECT type,timestamp FROM punches WHERE employee_id=? ORDER BY id DESC LIMIT 1").bind(emp.id).first();
          const type = last?.type === "in" ? "out" : "in";
          const timestamp = new Date().toISOString();
          await env.DB.prepare("INSERT INTO punches (employee_id,name,type,timestamp,client_ip) VALUES (?,?,?,?,?)").bind(emp.id, emp.name, type, timestamp, ip).run();
          return json({ ok: true, type, timestamp, employeeId: emp.id });
        } catch (e) { return json({ ok: false, message: "打刻保存エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/history" && request.method === "GET") {
        try {
          await ensureSchema(env); const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 200); const employeeId = url.searchParams.get("employeeId");
          const sql = employeeId ? "SELECT id,employee_id,name,type,timestamp,client_ip FROM punches WHERE employee_id=? ORDER BY id DESC LIMIT ?" : "SELECT id,employee_id,name,type,timestamp,client_ip FROM punches ORDER BY id DESC LIMIT ?";
          const r = employeeId ? await env.DB.prepare(sql).bind(employeeId, limit).all() : await env.DB.prepare(sql).bind(limit).all();
          return json({ ok: true, rows: r.results || [] });
        } catch (e) { return json({ ok: false, message: "履歴取得エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/auth" && request.method === "POST") {
        try { const body = await readJson(request); const ok = adminOk(body); return ok ? json({ ok: true }) : json({ ok: false, message: "管理者PINが違います。" }, 401); }
        catch (e) { return json({ ok: false, message: "管理者認証エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/punches" && request.method === "POST") {
        try { const body = await readJson(request); if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401); await ensureSchema(env); const rows = await env.DB.prepare(`SELECT id,employee_id,name,type,timestamp,client_ip,created_at FROM punches ORDER BY id DESC LIMIT 100`).all(); return json({ ok: true, rows: rows.results || [] }); }
        catch (e) { return json({ ok: false, message: "管理履歴取得エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/edit-history" && request.method === "POST") {
        try { const body = await readJson(request); if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401); await ensureSchema(env); const rows = await env.DB.prepare(`SELECT id,punch_id,employee_id,old_type,old_timestamp,new_type,new_timestamp,reason,edited_by,edited_at FROM punch_edits ORDER BY id DESC LIMIT 100`).all(); return json({ ok: true, rows: rows.results || [] }); }
        catch (e) { return json({ ok: false, message: "修正履歴取得エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/punch-edit" && request.method === "POST") {
        try {
          const body = await readJson(request); if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401); await ensureSchema(env);
          const rawPunchId = body?.punchId ?? body?.id; const punchId = Number.parseInt(String(rawPunchId ?? ""), 10); const newType = body?.newType; const newTimestamp = body?.newTimestamp; const reason = String(body?.reason || "").trim(); const editedBy = String(body?.editedBy || "管理者").trim().slice(0, 50);
          if (!Number.isInteger(punchId) || punchId <= 0) return json({ ok: false, message: "打刻IDが不正です。" }, 400);
          if (!['in','out'].includes(newType)) return json({ ok: false, message: "区分が不正です。" }, 400);
          if (!newTimestamp || Number.isNaN(Date.parse(newTimestamp))) return json({ ok: false, message: "日時が不正です。" }, 400);
          if (!reason) return json({ ok: false, message: "修正理由を入力してください。" }, 400);
          if (reason.length > 200) return json({ ok: false, message: "修正理由は200文字以内にしてください。" }, 400);
          const old = await env.DB.prepare("SELECT id,employee_id,type,timestamp FROM punches WHERE id=?").bind(punchId).first();
          if (!old) return json({ ok: false, message: "打刻が見つかりません。" }, 404);
          await env.DB.prepare("UPDATE punches SET type=?, timestamp=? WHERE id=?").bind(newType, newTimestamp, punchId).run();
          await env.DB.prepare(`INSERT INTO punch_edits (punch_id,employee_id,old_type,old_timestamp,new_type,new_timestamp,reason,edited_by) VALUES (?,?,?,?,?,?,?,?)`).bind(punchId, old.employee_id, old.type, old.timestamp, newType, newTimestamp, reason, editedBy).run();
          return json({ ok: true, message: "打刻を修正しました。" });
        } catch (e) { return json({ ok: false, message: "打刻修正エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/payroll" && request.method === "POST") {
        try {
          const body = await readJson(request);
          if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401);
          await ensureSchema(env);
          const month = String(body?.month || "");
          if (!/^\d{4}-\d{2}$/.test(month)) return json({ ok: false, message: "対象月が不正です。" }, 400);
          const [y, m] = month.split("-").map(Number);
          const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
          const end = new Date(Date.UTC(y, m, 1)).toISOString();
          const emps = await env.DB.prepare("SELECT id,name,hourly_wage,transport_allowance FROM employees WHERE active=1 ORDER BY id").all();
          const punches = await env.DB.prepare("SELECT id,employee_id,name,type,timestamp FROM punches WHERE timestamp>=? AND timestamp<? ORDER BY employee_id,id").bind(start,end).all();
          const byEmp = new Map();
          for (const e of (emps.results || [])) byEmp.set(e.id, { employeeId:e.id, name:e.name, hourlyWage:Number(e.hourly_wage||0), transportAllowance:Number(e.transport_allowance||0), workDays:0, minutes:0, wage:0, transport:0, total:0, incomplete:false });
          const grouped = new Map();
          for (const p of (punches.results || [])) { if (!grouped.has(p.employee_id)) grouped.set(p.employee_id, []); grouped.get(p.employee_id).push(p); }
          for (const [id, list] of grouped) {
            const row = byEmp.get(id); if (!row) continue;
            let open = null;
            for (const p of list) {
              if (p.type === "in") { if (!open) open = p; }
              else if (p.type === "out" && open) {
                const ms = Date.parse(p.timestamp) - Date.parse(open.timestamp);
                if (Number.isFinite(ms) && ms >= 0) { row.minutes += Math.round(ms / 60000); row.workDays += 1; }
                open = null;
              }
            }
            if (open) row.incomplete = true;
          }
          for (const row of byEmp.values()) {
            row.wage = Math.floor(row.minutes * row.hourlyWage / 60);
            row.transport = row.workDays * row.transportAllowance;
            row.total = row.wage + row.transport;
          }
          return json({ ok:true, month, rows:[...byEmp.values()] });
        } catch (e) { return json({ ok:false, message:"給与計算エラー: " + e.message },500); }
      }

      if (url.pathname === "/api/admin/employees" && request.method === "POST") {
        try { const body = await readJson(request); if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401); const rows = await getEmployees(env, true); return json({ ok: true, employees: rows }); }
        catch (e) { return json({ ok: false, message: "スタッフ管理情報取得エラー: " + e.message }, 500); }
      }

      if (url.pathname === "/api/admin/employee-update" && request.method === "POST") {
        try {
          const body = await readJson(request); if (!adminOk(body)) return json({ ok: false, message: "管理者PINが違います。" }, 401);
          await ensureSchema(env); const id = String(body?.id || "");
          if (!id) return json({ ok: false, message: "スタッフIDがありません。" }, 400);
          const wage = Math.max(0, Math.floor(Number(body?.hourlyWage || 0))); const transport = Math.max(0, Math.floor(Number(body?.transportAllowance || 0))); const pin = String(body?.pin || "");
          if (pin && !/^\d{4}$/.test(pin)) return json({ ok: false, message: "PINは4桁の数字です。" }, 400);
          if (pin) await env.DB.prepare("UPDATE employees SET hourly_wage=?,transport_allowance=?,pin=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(wage, transport, pin, id).run();
          else await env.DB.prepare("UPDATE employees SET hourly_wage=?,transport_allowance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(wage, transport, id).run();
          return json({ ok: true, message: "スタッフ情報を保存しました。" });
        } catch (e) { return json({ ok: false, message: "スタッフ情報保存エラー: " + e.message }, 500); }
      }

      return json({ ok: false, message: "Not Found" }, 404);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return asset;
      let html = await asset.text();
      const payrollScript = `<style>.payroll-panel{border:1px solid #eee;border-radius:14px;padding:12px;margin-top:12px}.payroll-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.payroll-tools input{font:inherit;padding:10px;border:1px solid #ccc;border-radius:10px}.payroll-table{margin-top:12px}.payroll-total{font-weight:700}.payroll-note{font-size:12px;color:#777;margin-top:8px}</style><script>
(function(){
  function initPayroll(){
    const admin=document.getElementById('adminPanel');
    if(!admin||document.getElementById('payrollPanel')) return;
    const panel=document.createElement('div'); panel.id='payrollPanel'; panel.className='payroll-panel';
    panel.innerHTML='<h3 class="section-title">給与計算・月別集計</h3><div class="payroll-tools"><div class="field" style="margin:0"><label>対象月</label><input id="payrollMonth" type="month"></div><button class="secondary" id="payrollCalc">給与計算</button><button class="secondary" id="payrollCsv">CSV出力</button></div><div id="payrollMsg" class="msg"></div><div class="tablewrap payroll-table"><table><thead><tr><th>名前</th><th>勤務日数</th><th>勤務時間</th><th>時給</th><th>給与</th><th>交通費</th><th>支給額</th><th>備考</th></tr></thead><tbody id="payrollRows"><tr><td colspan="8">対象月を選択して「給与計算」を押してください。</td></tr></tbody></table></div><div class="payroll-note">※ 深夜割増は計算しません。出勤→退勤のペアで勤務時間を集計し、交通費は「1勤務あたり」で計算します。未退勤の打刻は給与計算に含めず備考に表示します。</div>';
    admin.appendChild(panel);
    const d=new Date(); document.getElementById('payrollMonth').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    document.getElementById('payrollCalc').onclick=()=>loadPayroll(false);
    document.getElementById('payrollCsv').onclick=()=>loadPayroll(true);
  }
  function yen(n){return Number(n||0).toLocaleString('ja-JP')+'円'}
  function hours(min){return Math.floor(min/60)+':'+String(min%60).padStart(2,'0')}
  async function loadPayroll(csv){
    const month=document.getElementById('payrollMonth')?.value; const msg=document.getElementById('payrollMsg');
    if(!month){msg.textContent='対象月を選択してください。';return;} msg.className='msg'; msg.textContent='計算中…';
    try{
      const d=await adminPost('/api/admin/payroll',{month}); const rows=d.rows||[];
      const total=rows.reduce((a,r)=>({wage:a.wage+r.wage,transport:a.transport+r.transport,total:a.total+r.total,minutes:a.minutes+r.minutes,days:a.days+r.workDays}),{wage:0,transport:0,total:0,minutes:0,days:0});
      document.getElementById('payrollRows').innerHTML=rows.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+r.workDays+'日</td><td>'+hours(r.minutes)+'</td><td>'+yen(r.hourlyWage)+'</td><td>'+yen(r.wage)+'</td><td>'+yen(r.transport)+'</td><td>'+yen(r.total)+'</td><td>'+(r.incomplete?'未退勤あり':'')+'</td></tr>').join('')+'<tr class="payroll-total"><td>合計</td><td>'+total.days+'日</td><td>'+hours(total.minutes)+'</td><td>—</td><td>'+yen(total.wage)+'</td><td>'+yen(total.transport)+'</td><td>'+yen(total.total)+'</td><td></td></tr>';
      msg.textContent=rows.length+'名を集計しました。'; msg.className='msg success'; window._payrollRows=rows; window._payrollMonth=month;
      if(csv){
        const lines=[['対象月','名前','勤務日数','勤務時間','時給','給与','交通費','支給額','備考'],...rows.map(r=>[month,r.name,r.workDays,hours(r.minutes),r.hourlyWage,r.wage,r.transport,r.total,r.incomplete?'未退勤あり':''])];
        lines.push([month,'合計',total.days,hours(total.minutes),'',total.wage,total.transport,total.total,'']);
        const text='\ufeff'+lines.map(a=>a.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
        const blob=new Blob([text],{type:'text/csv;charset=utf-8'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='KNOT_給与計算_'+month+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      }
    }catch(e){msg.className='msg';msg.textContent=e.message}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initPayroll); else initPayroll();
})();
</script>`;
      html=html.replace('</body>',payrollScript+'</body>');
      return new Response(html,{status:asset.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }
    return env.ASSETS.fetch(request);
  },
};
