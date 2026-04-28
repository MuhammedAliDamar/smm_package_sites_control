import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const CreateSchema = z.object({
  username: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  note: z.string().max(500).optional(),
});

export async function GET() {
  const list = await prisma.trackedUsername.findMany({
    orderBy: { addedAt: "desc" },
  });
  return NextResponse.json({ data: list });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const row = await prisma.trackedUsername.create({
      data: { username: parsed.data.username, note: parsed.data.note ?? null },
    });
    return NextResponse.json({ data: row });
  } catch {
    return NextResponse.json(
      { error: "Username already exists" },
      { status: 409 },
    );
  }
}
