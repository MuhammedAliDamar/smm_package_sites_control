"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ListOrdered, CheckCircle2, Clock, XCircle, DollarSign,
  Users as UsersIcon, RefreshCw, AlertTriangle, Activity,
  Plus, Trash2, Power, Search, X, Globe, ArrowUp, ArrowDown,
} from "lucide-react";

type Stats = {
  totalOrders: number;
  completed: number;
  inProgress: number;
  pending: number;
  canceled: number;
  partial: number;
  chargeSum: number;
  last24h: number;
  lastSync: {
    startedAt: string;
    finishedAt: string | null;
    ordersFetched: number;
    error: string | null;
  } | null;
  trackedActive: number;
  trackedTotal: number;
  scopeUser: string | null;
};

type Tracked = {
  id: number; username: string; active: boolean;
  note: string | null; lastSyncedAt: string | null;
  addedAt: string; orderCount: number;
};

type SyncRow = {
  id: number; startedAt: string; finishedAt: string | null;
  usernamesCount: number; ordersFetched: number;
  ordersInserted: number; ordersUpdated: number;
  triggeredBy: string; error: string | null;
};

type OrderRow = {
  id: number; username: string; serviceName: string | null;
  link: string | null; quantity: number | null;
  startCount: number | null; remains: number | null;
  status: string; chargeValue: number | null; chargeCurrency: string | null;
  provider: string | null; createdAt: string;
};

type Filters = { user: string; status: string; q: string; from: string; to: string };
type Sort = { field: string; dir: "asc" | "desc" };
type OrdersBlock = {
  list: OrderRow[]; total: number; page: number; pageSize: number;
  statusOptions: string[]; usernameOptions: string[];
  filters: Filters; sort: Sort;
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
}
function dur(start: string, end: string | null) {
  if (!end) return "...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const STATUS_BADGE: Record<string, string> = {
  completed: "badge-success", complete: "badge-success",
  inprogress: "badge-info", in_progress: "badge-info", processing: "badge-info",
  pending: "badge-warning", partial: "badge-warning",
  canceled: "badge-danger", cancelled: "badge-danger",
};
function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status.toLowerCase().replace(/\s+/g, "_")] ?? "";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function StatCard({
  label, value, hint, icon: Icon, tone = "default",
}: {
  label: string; value: string | number; hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const colorMap = {
    default: "var(--accent)", success: "var(--success)",
    warning: "var(--warning)", danger: "var(--danger)", info: "var(--info)",
  };
  const c = colorMap[tone];
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        color: c,
      }}>
        <Icon size={16} />
      </div>
      <div className="stat-body">
        <div className="stat-label" title={label}>{label}</div>
        <div className="stat-value" title={String(value)}>{value}</div>
        {hint && <div className="stat-hint" title={hint}>{hint}</div>}
      </div>
    </div>
  );
}

const SORT_LABELS: Record<string, string> = {
  id: "ID", username: "User", serviceName: "Service",
  quantity: "Qty", startCount: "Start", remains: "Remains", status: "Status",
  chargeValue: "Charge", createdAt: "Date",
};

export default function DashboardClient({
  stats, tracked: initialTracked, recentSyncs, orders,
}: {
  stats: Stats; tracked: Tracked[]; recentSyncs: SyncRow[]; orders: OrdersBlock;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tracked, setTracked] = useState(initialTracked);
  const [newUsername, setNewUsername] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchInput, setSearchInput] = useState(orders.filters.q);

  function pushFilters(next: Partial<Filters & { page: string; sort: string; dir: string }>) {
    const merged: Record<string, string> = {
      ...(orders.filters.user ? { user: orders.filters.user } : {}),
      ...(orders.filters.status ? { status: orders.filters.status } : {}),
      ...(orders.filters.q ? { q: orders.filters.q } : {}),
      ...(orders.filters.from ? { from: orders.filters.from } : {}),
      ...(orders.filters.to ? { to: orders.filters.to } : {}),
      ...(orders.sort.field !== "createdAt" || orders.sort.dir !== "desc"
        ? { sort: orders.sort.field, dir: orders.sort.dir } : {}),
    };
    for (const [k, v] of Object.entries(next)) {
      if (v === "" || v === undefined) delete merged[k];
      else merged[k] = String(v);
    }
    if (!("page" in next)) delete merged.page;
    const qs = new URLSearchParams(merged).toString();
    router.push(qs ? `?${qs}` : "?");
  }

  const setFilter = (key: keyof Filters, value: string) =>
    pushFilters({ [key]: value } as Partial<Filters>);

  function clearAll() {
    setSearchInput("");
    router.push("?");
  }

  function toggleSort(field: string) {
    const dir = orders.sort.field === field && orders.sort.dir === "desc" ? "asc" : "desc";
    pushFilters({ sort: field, dir });
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch("/api/cron/sync", { method: "POST" });
      startTransition(() => router.refresh());
    } finally {
      setSyncing(false);
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const res = await fetch("/api/usernames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername.trim(),
        note: newNote.trim() || undefined,
      }),
    });
    const j = await res.json();
    if (!res.ok) { setAddError(j.error ?? "Error"); return; }
    setTracked([{ ...j.data, orderCount: 0 }, ...tracked]);
    setNewUsername(""); setNewNote("");
    startTransition(() => router.refresh());
  }

  async function toggleActive(r: Tracked) {
    const res = await fetch(`/api/usernames/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    if (res.ok) setTracked(tracked.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
  }

  async function removeUser(r: Tracked) {
    if (!confirm(`Delete "${r.username}"?`)) return;
    const res = await fetch(`/api/usernames/${r.id}`, { method: "DELETE" });
    if (res.ok) {
      setTracked(tracked.filter((x) => x.id !== r.id));
      startTransition(() => router.refresh());
    }
  }

  const totalPages = Math.max(1, Math.ceil(orders.total / orders.pageSize));
  const f = orders.filters;
  const hasFilter = !!(f.user || f.status || f.q || f.from || f.to);
  const scopeLabel = stats.scopeUser ?? "All Users";

  function FilterPill({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
    return (
      <span className="badge badge-info" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 4px 3px 9px" }}>
        <span style={{ fontSize: 11 }}>{label}: <b>{value}</b></span>
        <button onClick={onClear} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2, display: "grid", placeItems: "center" }}>
          <X size={12} />
        </button>
      </span>
    );
  }

  function SortHeader({ field, children }: { field: string; children: React.ReactNode }) {
    const active = orders.sort.field === field;
    const Icon = orders.sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`sort-th ${active ? "sort-th-active" : ""}`} onClick={() => toggleSort(field)} title={`Sort by ${SORT_LABELS[field] ?? field}`}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {children}
          {active && <Icon size={11} />}
        </span>
      </th>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {stats.scopeUser ? (
              <>
                <span style={{ color: "var(--accent)" }}>@{stats.scopeUser}</span>
                <button className="btn btn-sm" onClick={() => setFilter("user", "")}>
                  <Globe size={12} /> Show All
                </button>
              </>
            ) : (
              <>Overview <span className="badge">All Users</span></>
            )}
          </h1>
          <p className="page-subtitle">
            Auto-sync every 10 minutes · last sync: {fmt(stats.lastSync?.finishedAt ?? stats.lastSync?.startedAt)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={syncNow} disabled={syncing}>
          <RefreshCw size={14} style={syncing ? { animation: "spin 1s linear infinite" } : undefined} />
          {syncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      <div className="stat-grid">
        <StatCard label={`Total Orders · ${scopeLabel}`} value={stats.totalOrders.toLocaleString("en-US")} hint={`Last 24h: ${stats.last24h.toLocaleString("en-US")}`} icon={ListOrdered} />
        <StatCard label="Completed" value={stats.completed.toLocaleString("en-US")} tone="success" icon={CheckCircle2} />
        <StatCard label="In Progress" value={stats.inProgress.toLocaleString("en-US")} tone="info" icon={Clock} hint={`Pending: ${stats.pending}`} />
        <StatCard label="Partial" value={stats.partial.toLocaleString("en-US")} tone="warning" icon={Activity} />
        <StatCard label="Canceled" value={stats.canceled.toLocaleString("en-US")} tone="danger" icon={XCircle} />
        <StatCard label="Total Charge" value={`$${stats.chargeSum.toFixed(2)}`} icon={DollarSign} />
        <StatCard label="Tracked Users" value={stats.trackedActive} hint={`Total ${stats.trackedTotal}`} icon={UsersIcon} />
        <StatCard
          label="Last Sync"
          value={stats.lastSync?.error ? "Error" : `${stats.lastSync?.ordersFetched ?? 0}`}
          hint={stats.lastSync?.error ? stats.lastSync.error.slice(0, 26) : "orders fetched"}
          tone={stats.lastSync?.error ? "warning" : "default"}
          icon={stats.lastSync?.error ? AlertTriangle : RefreshCw}
        />
      </div>

      <div className="split-2">
        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="section-head">
            <h2 className="section-title">Users</h2>
            <span className="badge">{tracked.length}</span>
          </div>

          <form onSubmit={addUser} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
            <input
              className="input input-sm"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
            />
            <input
              className="input input-sm"
              placeholder="Note (optional)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
            />
            {addError && <div className="badge badge-danger" style={{ padding: "6px 10px" }}>{addError}</div>}
            <button className="btn btn-primary btn-sm" type="submit">
              <Plus size={14} /> Add User
            </button>
          </form>

          <div style={{ maxHeight: 540, overflow: "auto" }}>
            <div
              onClick={() => setFilter("user", "")}
              className={`user-row ${!stats.scopeUser ? "is-active" : ""}`}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "var(--accent-soft)", color: "var(--accent)",
                display: "grid", placeItems: "center",
                flexShrink: 0,
              }}>
                <Globe size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: !stats.scopeUser ? "var(--accent)" : "var(--text)" }}>
                  All Users
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Aggregate analytics
                </div>
              </div>
            </div>

            {tracked.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No users yet. Add one above.
              </div>
            )}
            {tracked.map((r) => {
              const selected = f.user === r.username;
              return (
                <div
                  key={r.id}
                  onClick={() => setFilter("user", r.username)}
                  className={`user-row ${selected ? "is-active" : ""}`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 14, color: selected ? "var(--accent)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.username}
                      </span>
                      {!r.active && <span className="badge" style={{ fontSize: 10, padding: "1px 6px" }}>inactive</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                      {r.orderCount.toLocaleString("en-US")} orders · synced {fmt(r.lastSyncedAt)}
                    </div>
                    {r.note && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{r.note}</div>}
                  </div>
                  <button
                    className="btn btn-icon"
                    onClick={(e) => { e.stopPropagation(); toggleActive(r); }}
                    title={r.active ? "Deactivate" : "Activate"}
                  >
                    <Power size={13} />
                  </button>
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={(e) => { e.stopPropagation(); removeUser(r); }}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="section-head" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 className="section-title">
                Orders
                {stats.scopeUser && <span style={{ color: "var(--accent)", fontWeight: 500 }}>· @{stats.scopeUser}</span>}
              </h2>
              <span className="badge">{orders.total.toLocaleString("en-US")} results</span>
            </div>

            <div className="toolbar">
              <div className="search-wrap">
                <Search size={14} />
                <form onSubmit={(e) => { e.preventDefault(); setFilter("q", searchInput.trim()); }}>
                  <input
                    className="input input-sm"
                    placeholder="Search ID, link, service..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                </form>
              </div>
              <select
                value={f.status}
                onChange={(e) => setFilter("status", e.target.value)}
                className="input input-sm"
                style={{ width: "auto", minWidth: 130 }}
              >
                <option value="">All statuses</option>
                {orders.statusOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
              <input
                type="date"
                value={f.from}
                onChange={(e) => setFilter("from", e.target.value)}
                className="input input-sm"
                style={{ width: "auto" }}
                title="From"
              />
              <input
                type="date"
                value={f.to}
                onChange={(e) => setFilter("to", e.target.value)}
                className="input input-sm"
                style={{ width: "auto" }}
                title="To"
              />
              {hasFilter && (
                <button className="btn btn-sm" onClick={clearAll}>
                  <X size={13} /> Clear
                </button>
              )}
            </div>

            {(f.status || f.q || f.from || f.to) && (
              <div className="filter-pills">
                {f.status && <FilterPill label="Status" value={f.status} onClear={() => setFilter("status", "")} />}
                {f.q && <FilterPill label="Search" value={f.q} onClear={() => { setSearchInput(""); setFilter("q", ""); }} />}
                {f.from && <FilterPill label="From" value={f.from} onClear={() => setFilter("from", "")} />}
                {f.to && <FilterPill label="To" value={f.to} onClear={() => setFilter("to", "")} />}
              </div>
            )}
          </div>

          <div style={{ overflow: "auto", maxHeight: 640 }}>
            <table>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <SortHeader field="id">ID</SortHeader>
                  <SortHeader field="username">User</SortHeader>
                  <SortHeader field="serviceName">Service</SortHeader>
                  <SortHeader field="quantity">Qty</SortHeader>
                  <SortHeader field="startCount">Start</SortHeader>
                  <SortHeader field="remains">Remains</SortHeader>
                  <SortHeader field="status">Status</SortHeader>
                  <SortHeader field="chargeValue">Charge</SortHeader>
                  <SortHeader field="createdAt">Date</SortHeader>
                </tr>
              </thead>
              <tbody>
                {orders.list.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                    No orders found
                  </td></tr>
                )}
                {orders.list.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "var(--text-muted)" }}>{o.id}</td>
                    <td>
                      <button className="user-link" onClick={() => setFilter("user", o.username)}>
                        {o.username}
                      </button>
                    </td>
                    <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {o.link ? (
                        <a href={o.link} target="_blank" rel="noreferrer" title={o.serviceName ?? ""} style={{ color: "var(--text)", textDecoration: "none" }}>
                          {o.serviceName ?? "—"}
                        </a>
                      ) : (o.serviceName ?? "—")}
                    </td>
                    <td>{o.quantity?.toLocaleString("en-US") ?? "—"}</td>
                    <td>{o.startCount?.toLocaleString("en-US") ?? "—"}</td>
                    <td>{o.remains?.toLocaleString("en-US") ?? "—"}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {o.chargeValue != null ? `$${o.chargeValue.toFixed(4)}` : "—"}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{fmt(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm"
                disabled={orders.page <= 1}
                onClick={() => pushFilters({ page: String(Math.max(1, orders.page - 1)) })}
              >
                ← Previous
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Page {orders.page} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                disabled={orders.page >= totalPages}
                onClick={() => pushFilters({ page: String(Math.min(totalPages, orders.page + 1)) })}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="section-head">
          <h2 className="section-title">Recent Syncs</h2>
        </div>
        <div style={{ overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Users</th>
                <th>Fetched</th>
                <th>New</th>
                <th>Updated</th>
                <th>Trigger</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {recentSyncs.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>
                  No syncs yet
                </td></tr>
              )}
              {recentSyncs.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "var(--text-muted)" }}>#{r.id}</td>
                  <td style={{ fontSize: 13 }}>{fmt(r.startedAt)}</td>
                  <td style={{ fontSize: 13 }}>{dur(r.startedAt, r.finishedAt)}</td>
                  <td>{r.usernamesCount}</td>
                  <td>{r.ordersFetched}</td>
                  <td>{r.ordersInserted}</td>
                  <td>{r.ordersUpdated}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.triggeredBy}</td>
                  <td style={{ fontSize: 12, color: r.error ? "var(--danger)" : "var(--text-muted)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
    </>
  );
}
