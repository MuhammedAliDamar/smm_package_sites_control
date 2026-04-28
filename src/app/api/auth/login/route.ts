import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
  recordLoginAttempt,
  isRateLimited,
  LOCKOUT_THRESHOLD,
  LOCKOUT_MINUTES,
} from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }
  const { email, password } = parsed.data;

  if (await isRateLimited(email, ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });

  // Constant-time-ish: always run bcrypt to prevent user enumeration via timing.
  const DUMMY_HASH = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8Hc7VL3Xf3QhPS4D6t2qNPF1n8jz0a";
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!user || !passwordOk) {
    if (user) {
      const failed = user.failedLoginAttempts + 1;
      const shouldLock = failed >= LOCKOUT_THRESHOLD;
      await prisma.adminUser.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failed,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : user.lockedUntil,
        },
      });
    }
    await recordLoginAttempt(email, ip, false);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLoginAttempt(email, ip, false);
    return NextResponse.json(
      { error: "Account locked. Try again later." },
      { status: 423 },
    );
  }

  await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  const ua = req.headers.get("user-agent");
  const signed = await createSession(user.id, { ipAddress: ip, userAgent: ua });
  await setSessionCookie(signed);
  await recordLoginAttempt(email, ip, true);

  return NextResponse.json({ ok: true });
}
