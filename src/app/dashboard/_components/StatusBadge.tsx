const CLASS: Record<string, string> = {
  completed: "badge-success",
  complete: "badge-success",
  inprogress: "badge-info",
  in_progress: "badge-info",
  processing: "badge-info",
  pending: "badge-warning",
  partial: "badge-warning",
  canceled: "badge-danger",
  cancelled: "badge-danger",
  fail: "badge-danger",
  failed: "badge-danger",
  error: "badge-danger",
};

export default function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const cls = CLASS[key] ?? "";
  return <span className={`badge ${cls}`}>{status}</span>;
}
