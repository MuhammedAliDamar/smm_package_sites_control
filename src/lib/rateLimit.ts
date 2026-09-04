import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

// Basit in-memory fixed-window rate limiter (tek instance). Amaç: vanak API'lerini
// ve özellikle access-key brute-force'unu sınırlamak. Dağıtık ortamda Redis'e
// taşınabilir; tek sunucuda bu yeterli.
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = store.get(key);
  if (!b || b.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count++;
  return { ok: true, retryAfter: 0 };
}

// Sabit-zaman string karşılaştırma (timing attack'a karşı).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Bellek şişmesini önlemek için ara sıra süresi geçmiş bucket'ları temizle.
let lastSweep = 0;
export function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
}
