import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { clientIp, rateLimit, safeEqual, maybeSweep } from "@/lib/rateLimit";

// Vanak access-key gate. Sıkı rate limit (brute-force koruması) + same-origin +
// sabit-zaman key karşılaştırması. Doğruysa HttpOnly cookie set edilir.
const ATTEMPT_LIMIT = 20; // 60 sn'de 20 deneme / IP (typo'ya toleranslı; brute-force yine imkansız)
const ATTEMPT_WINDOW = 60_000;

function originOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin form POST'unda origin gelmeyebilir
  try {
    const o = new URL(origin).host;
    const allowed = env.APP_ORIGIN ? new URL(env.APP_ORIGIN.includes("://") ? env.APP_ORIGIN : `http://${env.APP_ORIGIN}`).host : req.headers.get("host");
    return o === allowed;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  maybeSweep();
  if (!originOk(req)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  const ip = clientIp(req);

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const key = (body.key ?? "").trim();
  if (!env.VANAK_ACCESS_KEY) {
    return NextResponse.json({ error: "Gate not configured" }, { status: 500 });
  }

  // DOĞRU key HER ZAMAN geçer (rate-limit'e takılmaz) — sadece YANLIŞ denemeler
  // sayılır. Böylece geçerli kullanıcı önceki typo'lardan kilitlenmez; saldırgan
  // ise doğru key'i bilmediği için yalnızca "yanlış" üretip limite takılır.
  if (!safeEqual(key, env.VANAK_ACCESS_KEY)) {
    // Yanlış deneme — gerçek IP varsa limitle (dev/no-proxy'de atla)
    if (ip !== "unknown") {
      const rl = rateLimit(`vanak-auth:${ip}`, ATTEMPT_LIMIT, ATTEMPT_WINDOW);
      if (!rl.ok) {
        return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
      }
    }
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("vanak_key", key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
