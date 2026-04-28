import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { runSync } = await import("../src/lib/sync");
  console.log("Senkron başlıyor...");
  const result = await runSync({ triggeredBy: "cli" });
  console.log("Bitti:", result);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
