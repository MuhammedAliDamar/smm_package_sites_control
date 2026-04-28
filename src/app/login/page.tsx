"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Lock } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Login failed");
      return;
    }
    startTransition(() => {
      const raw = params.get("redirect") ?? "";
      const safe = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
      router.push(safe);
      router.refresh();
    });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "var(--accent-soft)", color: "var(--accent)",
            display: "grid", placeItems: "center",
          }}>
            <Lock size={20} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>ThorSMM Admin</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Sign in to continue
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>
              Email
            </label>
            <input
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>
              Password
            </label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="badge badge-danger" style={{ padding: "8px 12px", justifyContent: "flex-start" }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={pending}>
            <LogIn size={16} /> {pending ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
