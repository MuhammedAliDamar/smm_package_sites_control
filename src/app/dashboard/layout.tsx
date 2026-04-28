import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import LogoutButton from "./_components/LogoutButton";
import ThemeToggle from "./_components/ThemeToggle";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect("/login");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-dot">T</div>
          ThorSMM Admin
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{session.email}</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
