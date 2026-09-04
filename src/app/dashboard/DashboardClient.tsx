"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ListOrdered, CheckCircle2, Clock, XCircle, DollarSign,
  Users as UsersIcon, RefreshCw, AlertTriangle, Activity,
  Plus, Trash2, Power, Search, X, Globe, ArrowUp, ArrowDown,
  TrendingDown, Check, ExternalLink, UserPlus, StickyNote, ChevronDown, Ban,
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
  avgDropRate: number;
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
  id: number; username: string; creationType: string | null; serviceId: number | null; serviceName: string | null;
  link: string | null; quantity: number | null;
  startCount: number | null; remains: number | null;
  currentCount: number | null; dropRate: number | null;
  dropCheckedAt: string | null;
  status: string; chargeValue: number | null; chargeCurrency: string | null;
  provider: string | null; createdAt: string;
  refillRequestedAt: string | null; refillCheckedAt: string | null;
  refillNoIncrease: boolean | null; refillCanceledAt: string | null; refillable: boolean;
  notes: { id: number; body: string; createdAt: string }[];
};

type Filters = { user: string; status: string; q: string; from: string; to: string; refill: string; type: string };
type Sort = { field: string; dir: "asc" | "desc" };
type OrdersBlock = {
  list: OrderRow[]; total: number; page: number; pageSize: number;
  statusOptions: string[]; typeOptions: string[]; usernameOptions: string[];
  filters: Filters; sort: Sort;
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
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
  label, value, hint, icon: Icon, tone = "default", onClick, active,
}: {
  label: string; value: string | number; hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  onClick?: () => void; active?: boolean;
}) {
  const colorMap = {
    default: "var(--accent)", success: "var(--success)",
    warning: "var(--warning)", danger: "var(--danger)", info: "var(--info)",
  };
  const c = colorMap[tone];
  return (
    <div
      className="stat-card"
      onClick={onClick}
      style={onClick ? {
        cursor: "pointer",
        borderColor: active ? c : undefined,
        boxShadow: active ? `inset 0 0 0 1px ${c}` : undefined,
      } : undefined}
      title={onClick ? "Click to filter" : undefined}
    >
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

function dropColor(rate: number): string {
  if (rate <= 5) return "var(--success)";
  if (rate <= 15) return "var(--warning)";
  return "var(--danger)";
}

const SORT_LABELS: Record<string, string> = {
  id: "ID", username: "User", serviceName: "Service",
  quantity: "Qty", startCount: "Start", remains: "Remains", dropRate: "Drop",
  status: "Status", chargeValue: "Charge", createdAt: "Date", lastNoteAt: "Note",
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
  const [checking, setChecking] = useState(false);
  const [searchInput, setSearchInput] = useState(orders.filters.q);
  const [showUserModal, setShowUserModal] = useState(false);
  const didAutoSync = useRef(false);

  useEffect(() => {
    if (didAutoSync.current) return;
    didAutoSync.current = true;
    setSyncing(true);
    fetch("/api/cron/sync", { method: "POST" }).then(() => {
      startTransition(() => router.refresh());
    }).catch(() => {}).finally(() => setSyncing(false));

    const interval = setInterval(() => {
      setSyncing(true);
      fetch("/api/cron/sync", { method: "POST" }).then(() => {
        startTransition(() => router.refresh());
      }).catch(() => {}).finally(() => setSyncing(false));
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [router, startTransition]);

  // 24 saatlik refill kontrolü — dashboard açıkken tetiklenir (mount + her 15 dk).
  // Süresi dolan (24h geçmiş, artış yok) refill'ler için 2. Slack mesajını yollar.
  // Tarayıcıdan bağımsız tam otomasyon için sunucuda `npm run cron:local` veya
  // gerçek cron ile /api/cron/refill-check çağrılmalı.
  const didRefillCheck = useRef(false);
  useEffect(() => {
    if (didRefillCheck.current) return;
    didRefillCheck.current = true;
    const run = () =>
      fetch("/api/cron/refill-check", { method: "POST" })
        .then(() => startTransition(() => router.refresh()))
        .catch(() => {});
    run();
    const t = setInterval(run, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [router, startTransition]);

  // 5 saatlik refill hatırlatmaları — dashboard açıkken 30 dk'da bir tetikle
  // (cron:local olmadan da çalışsın diye). Lib per-sipariş 5 saat kontrolü yapar.
  const didRefillReminder = useRef(false);
  useEffect(() => {
    if (didRefillReminder.current) return;
    didRefillReminder.current = true;
    const run = () => fetch("/api/cron/refill-reminders", { method: "POST" }).catch(() => {});
    run();
    const t = setInterval(run, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // /updates izleme — dashboard açıkken 10 dakikada bir bugüne ait yeni
  // güncellemeleri Telegram'a bildirir (cron:local olmadan da çalışsın diye).
  const didUpdatesCheck = useRef(false);
  useEffect(() => {
    if (didUpdatesCheck.current) return;
    didUpdatesCheck.current = true;
    const run = () => fetch("/api/cron/updates-check", { method: "POST" }).catch(() => {});
    run();
    const t = setInterval(run, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  function pushFilters(next: Partial<Filters & { page: string; sort: string; dir: string }>) {
    const merged: Record<string, string> = {
      ...(orders.filters.user ? { user: orders.filters.user } : {}),
      ...(orders.filters.status ? { status: orders.filters.status } : {}),
      ...(orders.filters.q ? { q: orders.filters.q } : {}),
      ...(orders.filters.from ? { from: orders.filters.from } : {}),
      ...(orders.filters.to ? { to: orders.filters.to } : {}),
      ...(orders.filters.refill ? { refill: orders.filters.refill } : {}),
      ...(orders.filters.type ? { type: orders.filters.type } : {}),
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

  const toggleStatus = (value: string) =>
    setFilter("status", orders.filters.status === value ? "" : value);

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

  const [checkProgress, setCheckProgress] = useState("");
  const [dropResults, setDropResults] = useState<Record<number, number | null | { error: string }>>({});
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());

  async function checkDrop() {
    const eligibleIds = orders.list
      .filter((o) => o.link && o.quantity && o.startCount && o.status.toLowerCase().includes("complet"))
      .map((o) => o.id);
    if (eligibleIds.length === 0) return;
    setChecking(true);
    setCheckingIds(new Set(eligibleIds));
    setCheckProgress(`0/${eligibleIds.length}`);
    try {
      for (let i = 0; i < eligibleIds.length; i += 10) {
        const batch = eligibleIds.slice(i, i + 10);
        const res = await fetch("/api/orders/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const json = await res.json();
        if (json.results) {
          setDropResults((prev) => {
            const next = { ...prev };
            for (const r of json.results) {
              next[r.orderId] = r.error ? { error: r.error } : r.dropRate;
            }
            return next;
          });
          setCheckingIds((prev) => {
            const next = new Set(prev);
            for (const id of batch) next.delete(id);
            return next;
          });
        }
        setCheckProgress(`${Math.min(i + 10, eligibleIds.length)}/${eligibleIds.length}`);
      }
      startTransition(() => router.refresh());
    } finally {
      setChecking(false);
      setCheckProgress("");
      setCheckingIds(new Set());
    }
  }

  const [refillState, setRefillState] = useState<Record<number, { requested: boolean; loading: boolean }>>({});

  async function requestRefill(o: OrderRow) {
    if (o.refillRequestedAt || refillState[o.id]?.requested) return;
    setRefillState((p) => ({ ...p, [o.id]: { requested: false, loading: true } }));
    try {
      const res = await fetch("/api/orders/refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id }),
      });
      if (res.ok || res.status === 409) {
        setRefillState((p) => ({ ...p, [o.id]: { requested: true, loading: false } }));
        startTransition(() => router.refresh());
      } else {
        setRefillState((p) => ({ ...p, [o.id]: { requested: false, loading: false } }));
      }
    } catch {
      setRefillState((p) => ({ ...p, [o.id]: { requested: false, loading: false } }));
    }
  }

  async function markRefilled(orderId: number) {
    try {
      const res = await fetch("/api/orders/refill", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId }),
      });
      if (res.ok) startTransition(() => router.refresh());
    } catch {
      /* sessiz */
    }
  }

  async function removeTracking(orderId: number) {
    try {
      const res = await fetch("/api/orders/refill", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, untrack: true }),
      });
      if (res.ok) {
        setRefillState((p) => { const n = { ...p }; delete n[orderId]; return n; });
        startTransition(() => router.refresh());
      }
    } catch {
      /* sessiz */
    }
  }

  // Sipariş iptal bildirimi (tüm siparişler): aynı kanala FARKLI mesaj. Aktif
  // refill varsa hatırlatmaları da durdurur.
  const [cancelLoading, setCancelLoading] = useState<Record<number, boolean>>({});
  async function cancelOrder(orderId: number) {
    setCancelLoading((p) => ({ ...p, [orderId]: true }));
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId }),
      });
      if (res.ok) startTransition(() => router.refresh());
    } catch {
      /* sessiz */
    } finally {
      setCancelLoading((p) => ({ ...p, [orderId]: false }));
    }
  }

  const [notesModalId, setNotesModalId] = useState<number | null>(null);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notifyChannel, setNotifyChannel] = useState(false);
  const [slackChannels, setSlackChannels] = useState<{ id: number; name: string }[]>([]);
  const [noteChannelId, setNoteChannelId] = useState(0);
  const [showSyncs, setShowSyncs] = useState(false);

  useEffect(() => {
    fetch("/api/slack/note-channels")
      .then((r) => r.json())
      .then((j) => setSlackChannels(j.channels ?? []))
      .catch(() => {});
  }, []);

  // Updates (thorsmmprovider /updates) elle kontrol
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatesResult, setUpdatesResult] = useState<string | null>(null);

  async function checkUpdates() {
    setCheckingUpdates(true);
    setUpdatesResult(null);
    try {
      const res = await fetch("/api/cron/updates-check", { method: "POST" });
      const j = await res.json();
      if (j.ok) {
        setUpdatesResult(j.seeded ? "Baseline set" : `${j.new ?? 0} new · ${j.sent ?? 0} sent`);
      } else {
        setUpdatesResult(j.error ?? "failed");
      }
    } catch {
      setUpdatesResult("failed");
    } finally {
      setCheckingUpdates(false);
    }
  }

  const notesOrder = notesModalId != null ? orders.list.find((o) => o.id === notesModalId) ?? null : null;

  async function addNote(orderId: number) {
    const body = newNoteBody.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, notify: notifyChannel, channelId: noteChannelId }),
      });
      if (res.ok) {
        setNewNoteBody("");
        startTransition(() => router.refresh());
      }
    } finally {
      setSavingNote(false);
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
  const hasFilter = !!(f.user || f.status || f.q || f.refill || f.type);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn" onClick={() => setShowUserModal(true)}>
            <UserPlus size={14} /> Add User
          </button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2 }}>
            <button className="btn" onClick={checkUpdates} disabled={checkingUpdates} title="Check thorsmmprovider /updates for today's rate changes">
              <RefreshCw size={14} style={checkingUpdates ? { animation: "spin 1s linear infinite" } : undefined} />
              {checkingUpdates ? "Checking..." : "Check Services Updates"}
            </button>
            {updatesResult && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{updatesResult}</span>
            )}
          </div>
          <button className="btn btn-primary" onClick={syncNow} disabled={syncing}>
            <RefreshCw size={14} style={syncing ? { animation: "spin 1s linear infinite" } : undefined} />
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label={`Total Orders · ${scopeLabel}`} value={stats.totalOrders.toLocaleString("en-US")} hint={`Last 24h: ${stats.last24h.toLocaleString("en-US")}`} icon={ListOrdered}
          onClick={() => setFilter("status", "")} active={!f.status} />
        <StatCard label="Completed" value={stats.completed.toLocaleString("en-US")} tone="success" icon={CheckCircle2}
          onClick={() => toggleStatus("completed")} active={f.status === "completed"} />
        <StatCard label="In Progress" value={stats.inProgress.toLocaleString("en-US")} tone="info" icon={Clock} hint={`Pending: ${stats.pending}`}
          onClick={() => toggleStatus("in_progress,processing")} active={f.status === "in_progress,processing"} />
        <StatCard label="Partial" value={stats.partial.toLocaleString("en-US")} tone="warning" icon={Activity}
          onClick={() => toggleStatus("partial")} active={f.status === "partial"} />
        <StatCard label="Canceled" value={stats.canceled.toLocaleString("en-US")} tone="danger" icon={XCircle}
          onClick={() => toggleStatus("canceled")} active={f.status === "canceled"} />
        <StatCard label="Avg Drop Rate" value={`%${stats.avgDropRate.toFixed(1)}`} tone={stats.avgDropRate > 15 ? "danger" : stats.avgDropRate > 5 ? "warning" : "success"} icon={TrendingDown} />
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

      {showUserModal && (
        <div onClick={() => setShowUserModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
        <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", width: "100%", maxWidth: 460, maxHeight: "85vh" }}>
          <div className="section-head">
            <h2 className="section-title">Users</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="badge">{tracked.length}</span>
              <button className="btn btn-icon btn-sm" onClick={() => setShowUserModal(false)} title="Close"><X size={14} /></button>
            </div>
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
        </div>
      )}

      <div>
        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="section-head" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 className="section-title">
                Orders
                {stats.scopeUser && <span style={{ color: "var(--accent)", fontWeight: 500 }}>· @{stats.scopeUser}</span>}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="btn btn-sm" onClick={checkDrop} disabled={checking}>
                  <TrendingDown size={13} />
                  {checking ? `Checking ${checkProgress}` : "Check Drop"}
                </button>
                <span className="badge">{orders.total.toLocaleString("en-US")} results</span>
              </div>
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
                value={f.user}
                onChange={(e) => setFilter("user", e.target.value)}
                className="input input-sm"
                style={{ width: "auto", minWidth: 150 }}
              >
                <option value="">All users</option>
                {orders.usernameOptions.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
              <select
                value={f.status}
                onChange={(e) => setFilter("status", e.target.value)}
                className="input input-sm"
                style={{ width: "auto", minWidth: 130 }}
              >
                <option value="">All statuses</option>
                {orders.statusOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
              <select
                value={f.refill}
                onChange={(e) => setFilter("refill", e.target.value)}
                className="input input-sm"
                style={{ width: "auto", minWidth: 130 }}
              >
                <option value="">All refills</option>
                <option value="any">Any refill</option>
                <option value="tracking">Tracking</option>
                <option value="noincrease">No increase</option>
                <option value="refilled">Refilled</option>
              </select>
              <select
                value={f.type}
                onChange={(e) => setFilter("type", e.target.value)}
                className="input input-sm"
                style={{ width: "auto", minWidth: 130 }}
              >
                <option value="">All types</option>
                {orders.typeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
              {hasFilter && (
                <button className="btn btn-sm" onClick={clearAll}>
                  <X size={13} /> Clear
                </button>
              )}
            </div>

            {(f.status || f.q || f.refill || f.type) && (
              <div className="filter-pills">
                {f.status && <FilterPill label="Status" value={f.status} onClear={() => setFilter("status", "")} />}
                {f.type && <FilterPill label="Type" value={f.type} onClear={() => setFilter("type", "")} />}
                {f.refill && <FilterPill label="Refill" value={f.refill} onClear={() => setFilter("refill", "")} />}
                {f.q && <FilterPill label="Search" value={f.q} onClear={() => { setSearchInput(""); setFilter("q", ""); }} />}
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
                  <SortHeader field="dropRate">Drop</SortHeader>
                  <SortHeader field="status">Status</SortHeader>
                  <SortHeader field="chargeValue">Charge</SortHeader>
                  <SortHeader field="createdAt">Date</SortHeader>
                  <SortHeader field="lastNoteAt">Note</SortHeader>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.list.length === 0 && (
                  <tr><td colSpan={12} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>
                    No orders found
                  </td></tr>
                )}
                {orders.list.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, color: "var(--text-muted)" }}>{o.id}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button className="user-link" onClick={() => setFilter("user", o.username)} style={{ textAlign: "left" }}>
                          {o.username}
                        </button>
                        {o.creationType && (
                          <button
                            onClick={() => setFilter("type", o.creationType ?? "")}
                            className="badge"
                            style={{ fontSize: 10, padding: "1px 6px", cursor: "pointer", border: "none", flexShrink: 0 }}
                            title={`Filter: ${o.creationType}`}
                          >
                            {o.creationType}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ maxWidth: 340 }}>
                      {o.link && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <a
                            href={o.link}
                            target="_blank"
                            rel="noreferrer"
                            title={o.link}
                            style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                          >
                            {o.link}
                          </a>
                          <a
                            href={o.link}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-icon btn-sm"
                            title="Open in new tab"
                            style={{ flexShrink: 0 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                      <div
                        style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={`${o.serviceId != null ? `${o.serviceId} · ` : ""}${o.serviceName ?? ""}`}
                      >
                        {o.serviceId != null && (
                          <span style={{ color: "var(--text)", fontWeight: 600 }}>{o.serviceId}</span>
                        )}
                        {o.serviceId != null ? " · " : ""}
                        {o.serviceName ?? "—"}
                      </div>
                    </td>
                    <td>{o.quantity?.toLocaleString("en-US") ?? "—"}</td>
                    <td>{o.startCount?.toLocaleString("en-US") ?? "—"}</td>
                    <td>{o.remains?.toLocaleString("en-US") ?? "—"}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {checkingIds.has(o.id) ? (
                        <span className="spinner" style={{ display: "inline-block", width: 16, height: 16, border: "2px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          {(() => {
                            const raw = dropResults[o.id] !== undefined ? dropResults[o.id] : o.dropRate;
                            if (raw && typeof raw === "object" && "error" in raw) {
                              const err = raw.error;
                              const m = err.match(/counter_http_(\d+)\s+\S+\s+(.*)/);
                              const reason = m ? `${m[1]} ${m[2]}` : err;
                              return (
                                <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
                                  <span style={{ color: "var(--danger, #ef4444)", fontWeight: 600, cursor: "help" }} title={err}>Error</span>
                                  <span style={{ fontSize: 10, color: "var(--text-muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={err}>{reason}</span>
                                </span>
                              );
                            }
                            if (raw == null) return <span>—</span>;
                            if (raw <= 0) return <span style={{ color: "var(--success)", fontWeight: 600 }} title={o.dropCheckedAt ? `Checked: ${fmt(o.dropCheckedAt)}` : ""}>No Drop</span>;
                            return <span style={{ color: dropColor(raw), fontWeight: 600 }} title={o.dropCheckedAt ? `Checked: ${fmt(o.dropCheckedAt)}` : ""}>%{raw.toFixed(1)}</span>;
                          })()}
                          {o.currentCount != null && o.quantity != null && (
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }} title="Current count / Quantity">
                              {o.currentCount.toLocaleString("en-US")} / {o.quantity.toLocaleString("en-US")}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td><StatusBadge status={o.status} /></td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>
                      {o.chargeValue != null ? `$${o.chargeValue.toFixed(4)}` : "—"}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{fmt(o.createdAt)}</td>
                    <td>
                      <button
                        className="btn btn-icon btn-sm"
                        onClick={() => { setNotesModalId(o.id); setNewNoteBody(""); }}
                        title={o.notes.length ? `${o.notes.length} note(s)` : "Add note"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <StickyNote size={13} style={o.notes.length ? { color: "var(--accent)" } : undefined} />
                        {o.notes.length > 0 && <span style={{ fontSize: 11 }}>{o.notes.length}</span>}
                      </button>
                    </td>
                    <td>
                      {(() => {
                        // Refill butonu: raw.actions.refill === true olanlarda görünür
                        const localReq = refillState[o.id]?.requested;
                        const loading = refillState[o.id]?.loading;
                        const requested = Boolean(o.refillRequestedAt) || localReq;
                        const cLoad = cancelLoading[o.id];

                        // Cancel butonu — TÜM siparişlerde (Slack'e farklı mesaj)
                        const cancelBtn = (
                          <button
                            className="btn btn-icon btn-sm btn-danger"
                            onClick={() => cancelOrder(o.id)}
                            disabled={cLoad}
                            title="Cancel — notify Slack"
                          >
                            <Ban size={13} style={cLoad ? { animation: "spin 1s linear infinite" } : undefined} />
                          </button>
                        );

                        // Refill kısmı — sadece raw.actions.refill true olanlarda
                        let refillPart: React.ReactNode = null;
                        if (requested) {
                          const canceled = Boolean(o.refillCanceledAt);
                          const done = Boolean(o.refillCheckedAt);
                          const label = canceled ? "Canceled" : done ? (o.refillNoIncrease ? "No increase" : "Refilled") : "Tracking";
                          const tone = canceled ? "badge-muted" : done && o.refillNoIncrease ? "badge-danger" : done ? "badge-success" : "badge-info";
                          const isNoIncrease = !canceled && done && o.refillNoIncrease;
                          refillPart = (
                            <>
                              <span
                                className={`badge ${tone}`}
                                onDoubleClick={isNoIncrease ? () => markRefilled(o.id) : undefined}
                                title={isNoIncrease ? "Double-click: mark as Refilled" : (o.refillRequestedAt ? `Requested: ${fmt(o.refillRequestedAt)}` : "")}
                                style={isNoIncrease ? { cursor: "pointer" } : undefined}
                              >
                                <Check size={11} /> {label}
                              </span>
                              <button className="btn btn-icon btn-sm" onClick={() => removeTracking(o.id)} title="Remove tracking">
                                <X size={12} />
                              </button>
                            </>
                          );
                        } else if (o.refillable) {
                          refillPart = (
                            <button className="btn btn-icon btn-sm" onClick={() => requestRefill(o)} disabled={loading} title="Request refill">
                              <RefreshCw size={13} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
                            </button>
                          );
                        }

                        return (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {refillPart}
                            {cancelBtn}
                          </span>
                        );
                      })()}
                    </td>
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

      <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 16 }}>
        <button
          onClick={() => setShowSyncs((v) => !v)}
          className="section-head"
          style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <h2 className="section-title">Recent Syncs</h2>
          <ChevronDown size={16} style={{ transform: showSyncs ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>
        {showSyncs && (
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
        )}
      </div>

      {notesOrder && (
        <div onClick={() => setNotesModalId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", width: "100%", maxWidth: 460, maxHeight: "85vh" }}>
            <div className="section-head">
              <h2 className="section-title">Notes · #{notesOrder.id}</h2>
              <button className="btn btn-icon btn-sm" onClick={() => setNotesModalId(null)} title="Close"><X size={14} /></button>
            </div>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "grid", gap: 8 }}>
              <textarea
                className="input input-sm"
                placeholder="New note..."
                value={newNoteBody}
                onChange={(e) => setNewNoteBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(notesOrder.id); }}
                rows={2}
                style={{ resize: "vertical" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={notifyChannel}
                    onChange={(e) => setNotifyChannel(e.target.checked)}
                  />
                  Notify Slack channel
                </label>
                {notifyChannel && slackChannels.length > 0 && (
                  <select
                    value={noteChannelId}
                    onChange={(e) => setNoteChannelId(Number(e.target.value))}
                    style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}
                  >
                    {slackChannels.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => addNote(notesOrder.id)} disabled={savingNote || !newNoteBody.trim()}>
                <Plus size={14} /> {savingNote ? "Adding..." : "Add Note"}
              </button>
            </div>
            <div style={{ overflow: "auto", padding: "8px 0" }}>
              {notesOrder.notes.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No notes yet.</div>
              )}
              {notesOrder.notes.map((n) => (
                <div key={n.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.body}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{fmt(n.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
    </>
  );
}
