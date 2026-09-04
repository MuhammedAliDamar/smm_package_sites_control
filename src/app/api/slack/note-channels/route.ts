import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Not modalında listelenecek Slack kanalları — sadece isim + index (URL gizli).
export async function GET() {
  return NextResponse.json({
    channels: env.SLACK_NOTE_CHANNELS.map((c, i) => ({ id: i, name: c.name })),
  });
}
