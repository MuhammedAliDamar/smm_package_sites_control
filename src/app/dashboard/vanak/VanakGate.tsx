"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

export default function VanakGate() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/vanak/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.ok) {
        // Sert yönlendirme: yeni cookie ile sunucu gate'i yeniden değerlendirsin
        // (router.refresh() bazen yeni cookie'yi almıyor).
        window.location.href = "/vanak";
        return;
      } else {
        const j = await res.json().catch(() => ({}));
        if (res.status === 401 || j.error === "Invalid key") {
          setError("❌ Wrong access key — please check and try again.");
        } else if (res.status === 429) {
          setError("Too many attempts. Please wait a moment and retry.");
        } else if (res.status === 403) {
          setError("Blocked: request must come from this app’s own address.");
        } else {
          setError(j.error ? `Error: ${j.error}` : "Access denied.");
        }
      }
    } catch {
      setError("Network error — is the server reachable?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <form onSubmit={submit} className="card" style={{ width: 360, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <KeyRound size={20} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Drop Rate Screen</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
          This screen requires an access key.
        </p>
        <input
          type="password"
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Access key"
          className="input"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            marginBottom: 12,
          }}
        />
        {error && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>
        )}
        <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Checking..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}
