import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

function fmtTime(ms) {
  const seconds = Math.floor((Number(ms) || 0) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function rateClass(rate) {
  if (rate >= 70) return "text-emerald-300";
  if (rate >= 40) return "text-amber-300";
  return "text-rose-300";
}

export default function HistoryPage() {
  useDocumentTitleScramble("Focus Buddy | Focus Session History");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState("Loading history...");
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState({
    total_sessions: 0,
    avg_focus_rate: 0,
    total_focus_ms: 0,
    total_distractions: 0,
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [fromDate, toDate]);

  async function loadHistory() {
    setIsLoading(true);
    try {
      const { response, payload } = await apiFetch(`/api/focus-sessions${query}`, { method: "GET" });
      if (!response.ok) {
        const reason = payload?.details?.reason || payload?.error || "Could not load history";
        throw new Error(reason);
      }

      const rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
      const nextSummary = payload?.summary || {};
      setSessions(rows);
      setSummary({
        total_sessions: Number(nextSummary.total_sessions || 0),
        avg_focus_rate: Number(nextSummary.avg_focus_rate || 0),
        total_focus_ms: Number(nextSummary.total_focus_ms || 0),
        total_distractions: Number(nextSummary.total_distractions || 0),
      });
      setStatus(rows.length ? "History loaded." : "No sessions found for selected range.");
    } catch (error) {
      setStatus(error.message || "Unable to load session history right now.");
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, [query]);

  async function clearHistory() {
    const confirmed = window.confirm("Delete all focus session history? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setIsLoading(true);
    try {
      const { response, payload } = await apiFetch("/api/focus-sessions", { method: "DELETE" });
      if (!response.ok) {
        const reason = payload?.details?.reason || payload?.error || "Failed to delete history";
        throw new Error(reason);
      }
      setFromDate("");
      setToDate("");
      await loadHistory();
      setStatus("All focus session history deleted.");
    } catch (error) {
      setStatus(error.message || "Failed to delete history.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section
      className="min-h-screen px-4 pb-10 pt-4 text-zinc-100 md:px-8"
      style={{
        backgroundColor: "#0a0a0c",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(0,255,255,0.08), transparent 35%), radial-gradient(circle at 80% 25%, rgba(255,255,255,0.06), transparent 30%), radial-gradient(circle at 50% 90%, rgba(0,255,255,0.06), transparent 35%)",
      }}
    >
      <div className="mx-auto grid max-w-7xl gap-4">
        <div className={`${GLASS_PANEL} p-5`}>
          <h1 className="text-xl font-semibold text-cyan-100">Focus Session History</h1>
          <p className="mt-1 text-sm text-zinc-400">Filter saved focus sessions and review trends.</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-10 rounded-xl border border-white/20 bg-black/30 px-3 text-sm text-zinc-100"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-10 rounded-xl border border-white/20 bg-black/30 px-3 text-sm text-zinc-100"
            />
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
              className="h-10 rounded-xl border border-white/20 bg-white/5 px-4 text-sm text-zinc-200 hover:bg-white/10"
            >
              Clear Filters
            </button>
            <button
              type="button"
              onClick={loadHistory}
              className="h-10 rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 text-sm text-cyan-100 hover:bg-cyan-300/20"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={clearHistory}
              className="h-10 rounded-xl border border-rose-300/40 bg-rose-300/10 px-4 text-sm text-rose-100 hover:bg-rose-300/20"
            >
              Delete History
            </button>
          </div>

          <p className="mt-3 text-xs text-zinc-400">{status}</p>
        </div>

        <div className={`${GLASS_PANEL} grid gap-2 p-5 md:grid-cols-4`}>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-semibold text-cyan-100">{summary.total_sessions}</div>
            <div className="text-xs text-zinc-400">Total Sessions</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-semibold text-cyan-100">{Math.round(summary.avg_focus_rate)}%</div>
            <div className="text-xs text-zinc-400">Avg Focus Rate</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-semibold text-cyan-100">{fmtTime(summary.total_focus_ms)}</div>
            <div className="text-xs text-zinc-400">Total Focus</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
            <div className="text-2xl font-semibold text-cyan-100">{summary.total_distractions}</div>
            <div className="text-xs text-zinc-400">Total Distractions</div>
          </div>
        </div>

        <div className={`${GLASS_PANEL} overflow-hidden p-0`}>
          {sessions.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">{isLoading ? "Loading..." : "No sessions found."}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-zinc-300">
                  <tr>
                    <th className="px-4 py-3 text-left">Ended At</th>
                    <th className="px-4 py-3 text-left">Session</th>
                    <th className="px-4 py-3 text-left">Focus</th>
                    <th className="px-4 py-3 text-left">Focus Rate</th>
                    <th className="px-4 py-3 text-left">Distractions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const rate = Math.round(Number(session.focus_rate || 0));
                    return (
                      <tr key={String(session.id)} className="border-t border-white/10">
                        <td className="px-4 py-3 text-zinc-200">{new Date(session.ended_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-zinc-300">{fmtTime(session.session_ms)}</td>
                        <td className="px-4 py-3 text-zinc-300">{fmtTime(session.focus_ms)}</td>
                        <td className={`px-4 py-3 font-medium ${rateClass(rate)}`}>{rate}%</td>
                        <td className="px-4 py-3 text-zinc-300">{Number(session.distraction_count || 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
