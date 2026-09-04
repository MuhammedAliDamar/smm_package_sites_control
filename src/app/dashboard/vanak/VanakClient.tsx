"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, TrendingDown, RotateCcw, Search, ArrowUp, ArrowDown } from "lucide-react";
import ServiceDrops from "./ServiceDrops";

type OrderRow = {
  id: number;
  serviceId: number | null;
  serviceName: string | null;
  link: string | null;
  quantity: number | null;
  startCount: number | null;
  currentCount: number | null;
  dropRate: number | null;
  dropCheckedAt: string | null;
  status: string;
  createdAt: string;
};

type Props = {
  stats: {
    totalCompleted: number;
    checkedCount: number;
    droppedCount: number;
  };
  orders: {
    list: OrderRow[];
    total: number;
    page: number;
    pageSize: number;
    drop: string;
    q: string;
    sort: string;
    dir: "asc" | "desc";
  };
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

function dropColor(rate: number): string {
  if (rate <= 5) return "var(--success)";
  if (rate <= 15) return "var(--warning)";
  return "var(--danger)";
}

const DROP_FILTERS = [
  { value: "", label: "All completed" },
  { value: "dropped", label: "Has drop" },
  { value: "checked", label: "Checked" },
  { value: "unchecked", label: "Unchecked" },
];

export default function VanakClient({ stats, orders }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState("");
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [dropResults, setDropResults] = useState<Record<number, number | null | { error: string }>>({});
  const [search, setSearch] = useState(orders.q);
  const [tab, setTab] = useState<"orders" | "services">("orders");

  // Sessiz oturum takibi — kullanıcı fark etmez, UI'da hiçbir şey değişmez.
  // Açılıştan kapanışa süre + IP + fingerprint + cihaz bilgisi loglanır.
  useEffect(() => {
    // Kalıcı cihaz kimliği (tekrar ziyaretleri eşler)
    let clientId = "";
    try {
      clientId = localStorage.getItem("vanak_cid") || "";
      if (!clientId) {
        clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem("vanak_cid", clientId);
      }
    } catch { /* yoksa geç */ }
    // Bu sayfa açılışına özel oturum kimliği
    const sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);

    // Basit fingerprint: sabit cihaz özelliklerinden hash
    const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
    const scr = typeof screen !== "undefined" ? screen : ({} as Screen);
    const screenStr = `${scr.width || 0}x${scr.height || 0}x${(scr as Screen).colorDepth || 0}`;
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
    const platform = (nav as Navigator & { platform?: string }).platform || "";
    const raw = [nav.userAgent, nav.language, screenStr, tz, platform, (nav as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency, (nav as Navigator & { deviceMemory?: number }).deviceMemory].join("|");
    let fp = 0;
    for (let i = 0; i < raw.length; i++) { fp = (fp * 31 + raw.charCodeAt(i)) | 0; }
    const fingerprint = (fp >>> 0).toString(16);

    const meta = {
      sessionId, clientId, fingerprint,
      language: nav.language || "",
      timezone: tz,
      screen: screenStr,
      platform,
      path: typeof window !== "undefined" ? window.location.pathname : "",
      referrer: typeof document !== "undefined" ? document.referrer : "",
    };

    const beat = () => {
      fetch("/api/vanak/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
        keepalive: true,
      }).catch(() => {});
    };
    const end = () => {
      try {
        const blob = new Blob([JSON.stringify({ sessionId, end: true })], { type: "application/json" });
        navigator.sendBeacon("/api/vanak/heartbeat", blob);
      } catch { /* geç */ }
    };

    beat();
    const id = setInterval(beat, 15000);
    window.addEventListener("pagehide", end);
    window.addEventListener("beforeunload", end);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", end);
      window.removeEventListener("beforeunload", end);
      end();
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(orders.total / orders.pageSize));

  // Mevcut filtre/sıra/arama durumunu koruyarak URL kur; override edilenleri değiştir.
  function buildUrl(overrides: Record<string, string | number | undefined>) {
    const base: Record<string, string> = {};
    if (orders.drop) base.drop = orders.drop;
    if (orders.q) base.q = orders.q;
    if (orders.sort) base.sort = orders.sort;
    if (orders.dir) base.dir = orders.dir;
    const merged = { ...base, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1)) params.set(k, String(v));
    }
    const qs = params.toString();
    return `/vanak${qs ? "?" + qs : ""}`;
  }

  function setDrop(value: string) {
    router.push(buildUrl({ drop: value || undefined, page: undefined }));
  }

  function submitSearch() {
    router.push(buildUrl({ q: search.trim() || undefined, page: undefined }));
  }

  function toggleSort(field: string) {
    // Aynı kolona tıklayınca yön değiştir; farklıysa desc başla.
    const dir = orders.sort === field && orders.dir === "desc" ? "asc" : "desc";
    router.push(buildUrl({ sort: field, dir, page: undefined }));
  }

  function goPage(p: number) {
    router.push(buildUrl({ page: p }));
  }

  async function checkIds(ids: number[]) {
    if (ids.length === 0) return;
    setChecking(true);
    setCheckingIds(new Set(ids));
    setCheckProgress(`0/${ids.length}`);
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const res = await fetch("/api/vanak/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const json = await res.json();
        if (json.results) {
          setDropResults((prev) => {
            const next = { ...prev };
            for (const r of json.results) next[r.orderId] = r.error ? { error: r.error } : r.dropRate;
            return next;
          });
          setCheckingIds((prev) => {
            const next = new Set(prev);
            for (const id of batch) next.delete(id);
            return next;
          });
        }
        setCheckProgress(`${Math.min(i + 10, ids.length)}/${ids.length}`);
      }
      startTransition(() => router.refresh());
    } finally {
      setChecking(false);
      setCheckProgress("");
      setCheckingIds(new Set());
    }
  }

  // Filtre: min qty 500, max start count 2000 (Service Drop Rate ile aynı kriter)
  const MIN_QTY = 500;
  const MAX_START = 2000;
  function checkAllOnPage() {
    const ids = orders.list
      .filter(
        (o) =>
          o.link &&
          o.quantity != null && o.quantity >= MIN_QTY &&
          o.startCount != null && o.startCount <= MAX_START,
      )
      .map((o) => o.id);
    checkIds(ids);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tabs + (orders) Check button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
          {/* Service Drop Rate sekmesi gizlendi (kod duruyor, istenirse geri açılır) */}
          {/* <TabButton active={tab === "services"} onClick={() => setTab("services")}>Service Drop Rate</TabButton> */}
        </div>
        {tab === "orders" && (
          <button className="btn btn-primary btn-sm" onClick={checkAllOnPage} disabled={checking} style={{ marginBottom: 6 }}>
            <TrendingDown size={15} />
            {checking ? `Checking ${checkProgress}` : "Check Drop (page)"}
          </button>
        )}
      </div>

      {tab === "services" && <ServiceDrops />}

      {tab === "orders" && (
      <>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <Stat label="Completed orders" value={stats.totalCompleted.toLocaleString("en-US")} />
        <Stat label="Checked" value={stats.checkedCount.toLocaleString("en-US")} />
        <Stat label="Has drop" value={stats.droppedCount.toLocaleString("en-US")} tone="danger" />
      </div>

      {/* Filter + search — aynı satır */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative", flex: "1 1 auto", minWidth: 0 }}>
          <Search size={14} style={{ position: "absolute", left: 10, color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
            placeholder="Search service (name / id)..."
            style={{ padding: "7px 10px 7px 30px", flex: 1, minWidth: 0, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
          />
          {orders.q && (
            <button className="btn btn-sm" onClick={() => { setSearch(""); router.push(buildUrl({ q: undefined, page: undefined })); }} title="Clear">×</button>
          )}
          <button className="btn btn-sm btn-primary" onClick={submitSearch}>Search</button>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-muted)", marginLeft: 8 }}>Filter:</span>
        <select
          className="input"
          value={orders.drop}
          onChange={(e) => setDrop(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
        >
          {DROP_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {orders.total.toLocaleString("en-US")} orders
        </span>
      </div>

      {/* Pagination (top) */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <button className="btn btn-sm" onClick={() => goPage(orders.page - 1)} disabled={orders.page <= 1}>Prev</button>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {orders.page} / {totalPages}</span>
          <button className="btn btn-sm" onClick={() => goPage(orders.page + 1)} disabled={orders.page >= totalPages}>Next</button>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: "calc(100vh - 240px)" }}>
        <table>
          <thead>
            <tr>
              <SortHeader field="id" align="left" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>ID</SortHeader>
              <SortHeader field="serviceName" align="left" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Service</SortHeader>
              <SortHeader field="link" align="left" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Link</SortHeader>
              <SortHeader field="startCount" align="right" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Start</SortHeader>
              <SortHeader field="quantity" align="right" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Qty</SortHeader>
              <SortHeader field="currentCount" align="right" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Current / Qty</SortHeader>
              <SortHeader field="dropRate" align="right" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Drop</SortHeader>
              <SortHeader field="createdAt" align="center" sort={orders.sort} dir={orders.dir} onSort={toggleSort}>Date</SortHeader>
              <th style={{ textAlign: "center", padding: "10px 12px", position: "sticky", top: 0, background: "var(--panel)", zIndex: 2, boxShadow: "inset 0 -1px 0 var(--border)" }}></th>
            </tr>
          </thead>
          <tbody>
            {orders.list.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>No orders.</td></tr>
            )}
            {orders.list.map((o) => {
              const isChecking = checkingIds.has(o.id);
              const live = dropResults[o.id];
              const raw = live !== undefined ? live : o.dropRate;
              return (
                <tr key={o.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{o.id}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>#{o.serviceId ?? "—"}</div>
                    <div style={{ fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.serviceName ?? ""}>
                      {o.serviceName ?? "—"}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {o.link ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 280 }}>
                        <a href={o.link} target="_blank" rel="noreferrer" title={o.link} style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.link}
                        </a>
                        <a href={o.link} target="_blank" rel="noreferrer" title="Open in new tab" style={{ flexShrink: 0, display: "inline-flex", color: "var(--text-muted)" }}>
                          <ExternalLink size={13} />
                        </a>
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {o.startCount?.toLocaleString("en-US") ?? "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {o.quantity?.toLocaleString("en-US") ?? "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)", fontSize: 12 }}>
                    {o.currentCount != null && o.quantity != null
                      ? `${o.currentCount.toLocaleString("en-US")} / ${o.quantity.toLocaleString("en-US")}`
                      : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    {isChecking ? (
                      <ScrambleNumber />
                    ) : raw == null ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                    ) : typeof raw === "object" ? (
                      <span style={{ fontSize: 11, color: "var(--danger)" }} title={raw.error}>Error</span>
                    ) : raw <= 0 ? (
                      <span style={{ color: "var(--success)", fontWeight: 600 }} title={o.dropCheckedAt ? `Checked: ${fmt(o.dropCheckedAt)}` : ""}>No Drop</span>
                    ) : (
                      <span style={{ color: dropColor(raw), fontWeight: 600 }} title={o.dropCheckedAt ? `Checked: ${fmt(o.dropCheckedAt)}` : ""}>%{raw.toFixed(1)}</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {fmt(o.createdAt)}
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <button className="btn btn-sm btn-icon" onClick={() => checkIds([o.id])} disabled={checking || !o.link} title="Check drop">
                      <RotateCcw size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <button className="btn btn-sm" onClick={() => goPage(orders.page - 1)} disabled={orders.page <= 1}>Prev</button>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {orders.page} / {totalPages}</span>
          <button className="btn btn-sm" onClick={() => goPage(orders.page + 1)} disabled={orders.page >= totalPages}>Next</button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// Kontrol sırasında Drop hücresinde gerçek drop gibi 0–500 arası akan yüzde
// ("%X.X"), değere göre renkli (yüksek = kırmızı) — hesaplanıyor izlenimi verir.
function ScrambleNumber() {
  const [n, setN] = useState(() => Math.random() * 500);
  useEffect(() => {
    const id = setInterval(() => setN(Math.random() * 500), 70);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: dropColor(n) }}>
      %{n.toFixed(1)}
    </span>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        border: "none",
        background: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        color: active ? "var(--accent)" : "var(--text-muted)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function SortHeader({
  field, children, align, sort, dir, onSort,
}: {
  field: string;
  children: React.ReactNode;
  align: "left" | "right" | "center";
  sort: string;
  dir: "asc" | "desc";
  onSort: (f: string) => void;
}) {
  const active = sort === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{ textAlign: align, padding: "10px 12px", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", color: active ? "var(--text)" : undefined, position: "sticky", top: 0, background: "var(--panel)", zIndex: 2, boxShadow: "inset 0 -1px 0 var(--border)" }}
      title="Sort"
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}>
        {children}
        {active && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </span>
    </th>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  const color = tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : tone === "danger" ? "var(--danger)" : "var(--text)";
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color }}>{value}</div>
    </div>
  );
}
