import { NextResponse } from "next/server";
import { computeAllServiceDrops, getComputeProgress } from "@/lib/serviceDrops";

export const maxDuration = 300;

export async function POST() {
  const progress = await getComputeProgress();
  if (progress.running) return NextResponse.json({ started: false, running: true, ...progress });
  void computeAllServiceDrops().catch(() => {});
  return NextResponse.json({ started: true, running: true });
}

export async function GET() {
  return NextResponse.json(await getComputeProgress());
}
