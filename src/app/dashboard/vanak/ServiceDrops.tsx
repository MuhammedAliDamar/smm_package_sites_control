"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Play, X, ExternalLink } from "lucide-react";

const DAY_KEYS = ["3", "7", "10", "15", "30"] as const;

type Service = {
  serviceId: number;
  serviceName: string | null;
  orderCount: number;
  isTracked: boolean;
  dropRates: Record<string, number | null> | null;
  periodCounts: Record<string, number> | null;
  avgDropRate: number | null;
  processedCount: number;
  lastCheckedAt: string | null;
};

type DetailOrder = {
  orderId: number;
  dropRate: number;
  link: string | null;
  orderDate: string;
  quantity: number | null;
  startCount: number | null;
  currentCount: number;
};
type Detail = {
  serviceId: number;
  serviceName: string | null;
  days: number;
  avgDropRate: number | null;
  checkedCount: number;
  orders: DetailOrder[];
};

type ApiResp = {
  username: string;
  totalOrders: number;
  serviceCount: number;
  services: Service[];
};

type Progress = { running: boolean; total: number; done: number; startedAt: string | null; finishedAt: string | null; error?: string };

const stickyTh: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "var(--panel)",
  zIndex: 2,
  padding: "10px 12px",
  boxShadow: "inset 0 -1px 0 var(--border)",
};

function dropColor(rate: number): string {
  if (rate <= 0) return "var(--success)";
  if (rate <= 5) return "var(--text)";
  if (rate <= 15) return "var(--warning)";
  return "var(--danger)";
}

function pct(v: number | null | undefined) {
  if (v == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return <span style={{ color: dropColor(v), fontWeight: 600 }}>%{v.toFixed(2)}</span>;
}

function fmtDateTime(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

export default function ServiceDrops() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [modal, setModal] = useState<{ serviceId: number; serviceName: string | null; days: number } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set());
  const [cellBusy, setCellBusy] = useState<Set<string>>(new Set());

  // Tek servis + tek periyot (gün) yeniden hesapla
  async function refreshPeriod(serviceId: number, days: number) {
    const key = `${serviceId}-${days}`;
    setCellBusy((prev) => new Set(prev).add(key));
    try {
      await fetch(`/api/vanak/service-drops/compute-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, days }),
      });
      await load();
    } catch {
      /* ignore */
    } finally {
      setCellBusy((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }
  }

  async function refreshService(serviceId: number) {
    setRowBusy((prev) => new Set(prev).add(serviceId));
    try {
      await fetch(`/api/vanak/service-drops/compute-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });
      await load(); // güncel değerleri çek
    } catch {
      /* ignore */
    } finally {
      setRowBusy((prev) => {
        const n = new Set(prev);
        n.delete(serviceId);
        return n;
      });
    }
  }

  async function openDetail(serviceId: number, serviceName: string | null, days: number, count: number) {
    if (!count) return; // işlenen sipariş yoksa modal açma
    setModal({ serviceId, serviceName, days });
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/vanak/service-drops/detail?serviceId=${serviceId}&days=${days}`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setDetail(json);
    } finally {
      setDetailLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/vanak/service-drops`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ? `${res.status}: ${json.error}` : `Error ${res.status}`);
        return;
      }
      setData(json);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function pollProgress() {
    try {
      const res = await fetch(`/api/vanak/service-drops/compute`);
      if (!res.ok) return;
      const p: Progress = await res.json();
      setProgress(p);
      if (!p.running) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        await load(); // bitince tabloyu tazele
      }
    } catch {
      /* ignore */
    }
  }

  async function compute() {
    setError("");
    try {
      const res = await fetch(`/api/vanak/service-drops/compute`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ? `${res.status}: ${json.error}` : `Error ${res.status}`);
        return;
      }
      setProgress({ running: true, total: json.total ?? 0, done: json.done ?? 0, startedAt: json.startedAt ?? null, finishedAt: null });
      if (!pollRef.current) pollRef.current = setInterval(pollProgress, 2000);
    } catch {
      setError("Network error");
    }
  }

  useEffect(() => {
    load();
    // devam eden hesap varsa polling'e bağlan
    pollProgress().then(() => {
      if (progress?.running && !pollRef.current) pollRef.current = setInterval(pollProgress, 2000);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = progress?.running;

  const services = (data?.services ?? []).filter((s) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (s.serviceName ?? "").toLowerCase().includes(t) || String(s.serviceId).includes(t);
  });

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search service (name / id)..."
          style={{ ...inputStyle, width: "50%", minWidth: 260, flexShrink: 0 }}
        />
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} /> {loading ? "Loading..." : "Refresh"}
        </button>
        <button className="btn btn-sm btn-primary" onClick={compute} disabled={running}>
          <Play size={13} /> {running ? `Computing ${progress?.done ?? 0}/${progress?.total ?? 0}` : "Compute drop rates"}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {services.length.toLocaleString("en-US")} services
        </span>
      </div>

      {running && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Computing… {progress?.done ?? 0}/{progress?.total ?? 0} (service × period). The table will refresh automatically when done.
        </div>
      )}
      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: "calc(100vh - 200px)" }}>
        <table>
          <thead>
            <tr>
              <th style={{ ...stickyTh, textAlign: "left" }}>Service</th>
              {DAY_KEYS.map((d) => (
                <th key={d} style={{ ...stickyTh, textAlign: "right" }}>{d}d</th>
              ))}
              <th style={{ ...stickyTh, textAlign: "right" }}>Avg</th>
              <th style={{ ...stickyTh, textAlign: "right" }}>Processed</th>
              <th style={{ ...stickyTh, textAlign: "center" }}>Date</th>
              <th style={{ ...stickyTh, textAlign: "center" }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Loading…</td></tr>
            )}
            {data && services.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>No services. Run “Compute drop rates”.</td></tr>
            )}
            {services.map((s) => (
              <tr key={s.serviceId} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>#{s.serviceId}</div>
                  <div style={{ fontSize: 12, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.serviceName ?? ""}>
                    {s.serviceName ?? "—"}
                  </div>
                </td>
                {DAY_KEYS.map((d) => {
                  const count = s.periodCounts?.[d] ?? 0;
                  const clickable = count > 0;
                  const busy = cellBusy.has(`${s.serviceId}-${d}`);
                  return (
                    <td key={d} style={{ padding: "8px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                        <span
                          onClick={clickable ? () => openDetail(s.serviceId, s.serviceName, Number(d), count) : undefined}
                          title={clickable ? `${count} orders processed — click for details` : "no data"}
                          style={{ cursor: clickable ? "pointer" : "default", textDecoration: clickable ? "underline dotted" : "none", textUnderlineOffset: 3 }}
                        >
                          {pct(s.dropRates?.[d])}
                        </span>
                        <button
                          onClick={() => refreshPeriod(s.serviceId, Number(d))}
                          disabled={busy}
                          title={`Recalculate ${d}-day drop`}
                          style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: busy ? "default" : "pointer", color: "var(--text-muted)" }}
                        >
                          <RefreshCw size={11} style={busy ? { animation: "spin 1s linear infinite" } : undefined} />
                        </button>
                      </span>
                    </td>
                  );
                })}
                <td style={{ padding: "8px 12px", textAlign: "right" }}>{pct(s.avgDropRate)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {s.processedCount?.toLocaleString("en-US") ?? "0"}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {fmtDateTime(s.lastCheckedAt)}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "center" }}>
                  <button
                    className="btn btn-sm btn-icon"
                    onClick={() => refreshService(s.serviceId)}
                    disabled={rowBusy.has(s.serviceId)}
                    title="Recalculate this service"
                  >
                    <RefreshCw size={13} style={rowBusy.has(s.serviceId) ? { animation: "spin 1s linear infinite" } : undefined} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div
          onClick={() => setModal(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, zIndex: 1000, overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: 720, marginTop: 40, padding: 0 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {modal.days}-day drop · <span style={{ color: "var(--text-muted)" }}>#{modal.serviceId}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={modal.serviceName ?? ""}>
                  {modal.serviceName ?? "—"}
                </div>
                {detail && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Avg: {pct(detail.avgDropRate)} · {detail.checkedCount} orders processed
                  </div>
                )}
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => setModal(null)} title="Close"><X size={15} /></button>
            </div>
            <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
              {detailLoading && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>}
              {!detailLoading && detail && detail.orders.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>No orders.</div>
              )}
              {!detailLoading && detail && detail.orders.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th style={{ ...stickyTh, textAlign: "left", padding: "8px 12px" }}>Order</th>
                      <th style={{ ...stickyTh, textAlign: "right", padding: "8px 12px" }}>Start</th>
                      <th style={{ ...stickyTh, textAlign: "right", padding: "8px 12px" }}>Current / Qty</th>
                      <th style={{ ...stickyTh, textAlign: "right", padding: "8px 12px" }}>Drop</th>
                      <th style={{ ...stickyTh, textAlign: "center", padding: "8px 12px" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((o) => (
                      <tr key={o.orderId} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "7px 12px", fontVariantNumeric: "tabular-nums" }}>
                          {o.link ? (
                            <a href={o.link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {o.orderId} <ExternalLink size={11} />
                            </a>
                          ) : o.orderId}
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.startCount?.toLocaleString("en-US") ?? "—"}</td>
                        <td style={{ padding: "7px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)", fontSize: 12 }}>
                          {o.currentCount.toLocaleString("en-US")} / {o.quantity?.toLocaleString("en-US") ?? "—"}
                        </td>
                        <td style={{ padding: "7px 12px", textAlign: "right" }}>{pct(o.dropRate)}</td>
                        <td style={{ padding: "7px 12px", textAlign: "center", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtDateTime(o.orderDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
