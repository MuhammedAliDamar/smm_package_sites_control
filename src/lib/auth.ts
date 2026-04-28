import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual, createHmac } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { env } from "./env";

const COOKIE_NAME = "thorsmm_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BCRYPT_COST = 12;
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MINUTES = 30;
const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX = 8;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

function signSessionId(raw: string): string {
  const sig = createHmac("sha256", env.SESSION_SECRET).update(raw).digest("hex");
  return `${raw}.${sig}`;
}

function verifySessionId(signed: string): string | null {
  const idx = signed.indexOf(".");
  if (idx < 0) return null;
  const raw = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET).update(raw).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? raw : null;
}

export async function createSession(
  adminUserId: number,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: raw,
      adminUserId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return signSessionId(raw);
}

export type SessionUser = {
  sessionId: string;
  adminUserId: number;
  email: string;
};

export async function readSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const signed = store.get(COOKIE_NAME)?.value;
  if (!signed) return null;
  const id = verifySessionId(signed);
  if (!id) return null;
  const row = await prisma.session.findUnique({
    where: { id },
    include: { adminUser: true },
  });
  if (!row) return null;
  if (row.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  return {
    sessionId: row.id,
    adminUserId: row.adminUserId,
    email: row.adminUser.email,
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const signed = store.get(COOKIE_NAME)?.value;
  if (signed) {
    const id = verifySessionId(signed);
    if (id) await prisma.session.delete({ where: { id } }).catch(() => {});
  }
  store.delete(COOKIE_NAME);
}

export async function setSessionCookie(signedId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, signedId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function recordLoginAttempt(
  identifier: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { identifier, ipAddress, success },
  });
}

export async function isRateLimited(identifier: string, ipAddress: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000);
  const [byId, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { identifier, success: false, createdAt: { gt: since } },
    }),
    prisma.loginAttempt.count({
      where: { ipAddress, success: false, createdAt: { gt: since } },
    }),
  ]);
  return byId >= RATE_LIMIT_MAX || byIp >= RATE_LIMIT_MAX * 2;
}

export { COOKIE_NAME, SESSION_TTL_MS, LOCKOUT_THRESHOLD, LOCKOUT_MINUTES };
