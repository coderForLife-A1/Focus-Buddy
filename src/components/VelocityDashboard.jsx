import { useEffect, useMemo, useState } from "react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
} from "recharts";
import { Activity, Gauge, MessageSquareText, Radar } from "lucide-react";
import { apiFetch } from "../lib/api";

const GLASS_PANEL =
    "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

const DAYS_TO_SHOW = 7;

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

function dayLabel(date) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

function buildLast7DaysSeries(taskEfficiencyList) {
    const today = new Date();
    const dateMap = new Map();

    for (let offset = DAYS_TO_SHOW - 1; offset >= 0; offset -= 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - offset);
        const key = dayKey(d);
        dateMap.set(key, {
            dateKey: key,
            day: dayLabel(d),
            focusHours: 0,
            tasksCompleted: 0,
        });
    }

    for (const item of taskEfficiencyList) {
        const completedDate = String(item?.completedDateTime || "").trim();
        if (!completedDate) {
            continue;
        }

        const parsed = new Date(completedDate);
        if (Number.isNaN(parsed.getTime())) {
            continue;
        }

        const key = dayKey(parsed);
        const bucket = dateMap.get(key);
        if (!bucket) {
            continue;
        }

        bucket.tasksCompleted += 1;
        bucket.focusHours += Number(item?.actual_minutes || 0) / 60;
    }

    return Array.from(dateMap.values()).map((item) => ({
        ...item,
        focusHours: Number(item.focusHours.toFixed(2)),
    }));
}

function VelocityGauge({ score }) {
    const radius = 66;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(3, Number(score) || 0));
    const normalized = clamped / 3;
    const strokeDashoffset = circumference * (1 - normalized);
    const ringColor = clamped >= 1.6 ? "#22d3ee" : clamped >= 0.8 ? "#f59e0b" : "#fb7185";

    return (
        <div className="relative mx-auto flex h-44 w-44 items-center justify-center">
            <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
                <circle cx="90" cy="90" r={radius} stroke="rgba(255,255,255,0.18)" strokeWidth="14" fill="transparent" />
                <circle
                    cx="90"
                    cy="90"
                    r={radius}
                    stroke={ringColor}
                    strokeWidth="14"
                    strokeLinecap="round"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    className="transition-all duration-500"
                />
            </svg>
            <div className="absolute text-center">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Velocity</p>
                <p className="text-3xl font-semibold text-cyan-100">{clamped.toFixed(2)}</p>
                <p className="text-xs text-zinc-500">tasks / hour</p>
            </div>
        </div>
    );
}

export default function VelocityDashboard() {
    const [payload, setPayload] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let alive = true;

        async function loadVelocity() {
            setLoading(true);
            setError("");

            try {
                const { response, payload: body } = await apiFetch("/api/velocity", { method: "GET" });
                if (!response.ok) {
                    throw new Error(body?.details?.reason || body?.error || "Unable to decode velocity feed");
                }

                if (alive) {
                    setPayload(body || {});
                }
            } catch (err) {
                if (alive) {
                    setError(err.message || "Unable to decode velocity feed");
                    setPayload(null);
                }
            } finally {
                if (alive) {
                    setLoading(false);
                }
            }
        }

        loadVelocity();
        return () => {
            alive = false;
        };
    }, []);

    const efficiencyList = Array.isArray(payload?.task_efficiency_list) ? payload.task_efficiency_list : [];
    const chartData = useMemo(() => buildLast7DaysSeries(efficiencyList), [efficiencyList]);
    const totalHours = Number(payload?.total_hours || 0);
    const velocityScore = Number(payload?.velocity_score || 0);
    const cipherCritique = String(payload?.cipher_critique || "Cipher review pending.");

    const tasksCompleted = efficiencyList.length;
    const avgTaskMinutes =
        tasksCompleted > 0
            ? efficiencyList.reduce((sum, item) => sum + Number(item?.actual_minutes || 0), 0) / tasksCompleted
            : 0;

    return (
        <section
            className="min-h-screen px-4 pb-10 pt-4 text-zinc-100 md:px-8"
            style={{
                backgroundColor: "#0a0a0c",
                backgroundImage:
                    "radial-gradient(circle at 15% 15%, rgba(0,255,255,0.08), transparent 34%), radial-gradient(circle at 85% 25%, rgba(255,255,255,0.06), transparent 28%), radial-gradient(circle at 50% 88%, rgba(0,255,255,0.05), transparent 35%)",
            }}
        >
            <div className="mx-auto max-w-7xl space-y-4">
                <header className={`${GLASS_PANEL} flex flex-wrap items-center justify-between gap-3 p-5`}>
                    <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300/80">Command Console</p>
                        <h1 className="mt-1 text-2xl font-semibold text-cyan-100">Developer Velocity Matrix</h1>
                        <p className="mt-1 text-sm text-zinc-400">Seven-day telemetry for focus output, execution cadence, and Cipher diagnostics.</p>
                    </div>
                    <div className="rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs tracking-[0.14em] text-cyan-100">
                        LIVE FEED
                    </div>
                </header>

                {loading ? (
                    <div className={`${GLASS_PANEL} flex min-h-[240px] items-center justify-center p-6`}>
                        <div className="text-center">
                            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">Cipher Pipeline</p>
                            <p className="mt-2 text-2xl font-semibold text-cyan-100">Decoding Data...</p>
                            <p className="mt-2 text-sm text-zinc-400">Syncing Graph completions and focus telemetry from Supabase.</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className={`${GLASS_PANEL} border-rose-300/30 p-6`}>
                        <p className="text-xs uppercase tracking-[0.2em] text-rose-300">Decoder Fault</p>
                        <p className="mt-2 text-sm text-rose-100">{error}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                        <article className={`${GLASS_PANEL} p-5 sm:p-6 lg:col-span-8`}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-cyan-100">Focus Hours vs Tasks Completed</h2>
                                    <p className="text-sm text-zinc-400">Last 7 days, reconstructed from completed tasks and mapped focus duration.</p>
                                </div>
                                <Activity className="h-5 w-5 text-cyan-300" />
                            </div>
                            <div className="h-[320px] w-full">
                                <ResponsiveContainer>
                                    <LineChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 8 }}>
                                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                                        <XAxis dataKey="day" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                                        <YAxis yAxisId="left" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                                        <YAxis yAxisId="right" orientation="right" stroke="#a1a1aa" tickLine={false} axisLine={false} />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: "rgba(10, 10, 12, 0.95)",
                                                border: "1px solid rgba(34, 211, 238, 0.35)",
                                                borderRadius: "0.75rem",
                                                color: "#e4e4e7",
                                            }}
                                        />
                                        <Legend wrapperStyle={{ color: "#d4d4d8" }} />
                                        <Line
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="focusHours"
                                            name="Focus Hours"
                                            stroke="#22d3ee"
                                            strokeWidth={2.5}
                                            dot={{ r: 3, strokeWidth: 0, fill: "#22d3ee" }}
                                            activeDot={{ r: 5 }}
                                        />
                                        <Line
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="tasksCompleted"
                                            name="Tasks Completed"
                                            stroke="#f0abfc"
                                            strokeWidth={2.5}
                                            dot={{ r: 3, strokeWidth: 0, fill: "#f0abfc" }}
                                            activeDot={{ r: 5 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </article>

                        <article className={`${GLASS_PANEL} p-5 sm:p-6 lg:col-span-4`}>
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-cyan-100">Efficiency Gauge</h2>
                                <Gauge className="h-5 w-5 text-cyan-300" />
                            </div>
                            <VelocityGauge score={velocityScore} />
                            <p className="mt-3 text-center text-xs text-zinc-400">
                                Velocity Score = tasks completed / total focus hours
                            </p>
                        </article>

                        <article className={`${GLASS_PANEL} grid gap-3 p-5 sm:grid-cols-3 lg:col-span-12`}>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="mb-2 flex items-center gap-2 text-cyan-200">
                                    <Radar className="h-4 w-4" />
                                    <p className="text-xs uppercase tracking-[0.16em]">Velocity Score</p>
                                </div>
                                <p className="text-2xl font-semibold text-cyan-100">{velocityScore.toFixed(2)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="mb-2 flex items-center gap-2 text-cyan-200">
                                    <Activity className="h-4 w-4" />
                                    <p className="text-xs uppercase tracking-[0.16em]">Total Focus</p>
                                </div>
                                <p className="text-2xl font-semibold text-cyan-100">{totalHours.toFixed(2)}h</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="mb-2 flex items-center gap-2 text-cyan-200">
                                    <Gauge className="h-4 w-4" />
                                    <p className="text-xs uppercase tracking-[0.16em]">Avg Task Time</p>
                                </div>
                                <p className="text-2xl font-semibold text-cyan-100">{Math.round(avgTaskMinutes)}m</p>
                            </div>
                        </article>

                        <article className={`${GLASS_PANEL} p-6 lg:col-span-12`}>
                            <div className="mb-3 flex items-center gap-2 text-cyan-200">
                                <MessageSquareText className="h-5 w-5" />
                                <h2 className="text-lg font-semibold text-cyan-100">Cipher Performance Review</h2>
                            </div>
                            <p className="rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-4 text-sm leading-7 text-zinc-100">
                                {cipherCritique}
                            </p>
                        </article>
                    </div>
                )}
            </div>
        </section>
    );
}
