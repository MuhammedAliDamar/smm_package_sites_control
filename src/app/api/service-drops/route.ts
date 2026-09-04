import { NextResponse } from "next/server";
import { readServiceDrops } from "@/lib/serviceDrops";

export async function GET() {
  try {
    return NextResponse.json(await readServiceDrops());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
