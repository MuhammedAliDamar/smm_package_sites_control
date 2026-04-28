"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function SyncNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/cron/sync", { method: "POST" });
      await res.json().catch(() => null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const loading = busy || pending;
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={loading}>
      <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
      {loading ? "Senkronize ediliyor..." : "Şimdi Senkronize Et"}
      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
    </button>
  );
}
