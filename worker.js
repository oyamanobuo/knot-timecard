const STORE_IPV4 = "27.121.145.216";
// Store IPv6 prefix for the current test. This is a /64-style prefix, not a permanent contract setting.
const STORE_IPV6_PREFIX = "2001:f70:9160:600:";

const EMPLOYEES = {
  tanaka: { name: "田中", pin: "1234" },
  sato:   { name: "佐藤", pin: "2345" },
  yamada: { name: "山田", pin: "3456" },
  oyama:  { name: "大山", pin: "4567" },
};

// V1.1 is intentionally in-memory. It will reset when the Worker instance is recycled.
const punches = [];

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "";
}

function allowedIp(ip) {
  return ip === STORE_IPV4 || (ip.startsWith(STORE_IPV6_PREFIX));
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = clientIp(request);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/network" && request.method === "GET") {
        return json({ ok: true, allowed: allowedIp(ip), clientIp: ip });
      }

      if (url.pathname === "/api/status" && request.method === "GET") {
        return json({
          ok: true,
          service: "knot-timecard",
          version: "1.1",
          clientIp: ip,
          networkAllowed: allowedIp(ip),
          punchCountInThisInstance: punches.length
        });
      }

      // All actual authentication and punch operations are restricted to the store network.
      if (!allowedIp(ip)) return json({ ok: false, message: "店舗ネットワークからのみ利用できます。" }, 403);

      if (url.pathname === "/api/auth" && request.method === "POST") {
        const body = await readJson(request);
        const emp = body && EMPLOYEES[body.employeeId];
        if (!emp || body.pin !== emp.pin) return json({ ok: false, message: "PINが違います。" }, 401);
        return json({ ok: true, employeeId: body.employeeId, name: emp.name });
      }

      if (url.pathname === "/api/punch" && request.method === "POST") {
        const body = await readJson(request);
        const emp = body && EMPLOYEES[body.employeeId];
        if (!emp) return json({ ok: false, message: "スタッフが見つかりません。" }, 400);

        const last = [...punches].reverse().find(x => x.employeeId === body.employeeId);
        const type = last && last.type === "in" ? "out" : "in";
        const timestamp = new Date().toISOString();
        punches.push({ employeeId: body.employeeId, name: emp.name, type, timestamp, ip });
        return json({ ok: true, type, timestamp, employeeId: body.employeeId });
      }

      return json({ ok: false, message: "Not Found" }, 404);
    }

    // Static front-end is served from /public via the ASSETS binding.
    return env.ASSETS.fetch(request);
  }
};
