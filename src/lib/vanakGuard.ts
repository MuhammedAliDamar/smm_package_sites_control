import { NextResponse, type NextRequest } from "next/server";
import { env } from "./env";
import { clientIp, rateLimit, safeEqual, maybeSweep } from "./rateLimit";

// Vanak API guard: (1) rate limit (IP başına); (2) CORS/origin — istek yalnızca
// projenin kendi origin'inden gelmeli; (3) vanak_key cookie (sabit-zaman) doğrulaması.
// Uygunsa null döner, değilse hazır deny response döner.
const GENERAL_LIMIT = 120; // 60 sn'de 120 istek / IP (polling + normal kullanım)
const GENERAL_WINDOW = 60_000;

export function assertVanakAccess(req: NextRequest): NextResponse | null {
  maybeSweep();
  const ip = clientIp(req);

  // 1) Genel rate limit — yalnızca gerçek IP varsa (proxy XFF). Dev/no-proxy'de
  //    tüm istekler "unknown"a düşüp birbirini kilitlemesin diye atlanır.
  if (ip !== "unknown") {
    const rl = rateLimit(`vanak:${ip}`, GENERAL_LIMIT, GENERAL_WINDOW);
    if (!rl.ok) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
    }
  }

  // 2) CORS/origin — APP_ORIGIN set'liyse o; değilse isteğin kendi host'u (same-origin)
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const allowedHost = env.APP_ORIGIN ? safeHost(env.APP_ORIGIN) : host;
  if (origin) {
    const o = safeHost(origin);
    if (!o || o !== allowedHost) {
      return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
    }
  }

  // 3) Access key (session login yok) — sabit-zaman karşılaştırma
  if (env.VANAK_ACCESS_KEY) {
    const cookie = req.cookies.get("vanak_key")?.value ?? "";
    if (!safeEqual(cookie, env.VANAK_ACCESS_KEY)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  return null;
}

function safeHost(v: string): string | null {
  try {
    return new URL(v.includes("://") ? v : `http://${v}`).host;
  } catch {
    return null;
  }
}
