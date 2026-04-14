import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

function formatTime(seconds) {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const remainder = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function parseFallbackTasks(payload) {
  if (Array.isArray(payload?.tasks)) {
    return payload.tasks;
  }
  if (Array.isArray(payload?.todos)) {
    return payload.todos;
  }
  if (Array.isArray(payload?.data?.tasks)) {
    return payload.data.tasks;
  }
  return [];
}

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [feed, setFeed] = useState([
    {
      id: "boot-1",
      role: "aria",
      text: "Aria online. Ask for summaries, humanized text, or timer commands.",
      ts: new Date().toISOString(),
    },
  ]);
  const [command, setCommand] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setRemainingSeconds(durationMinutes * 60);
  }, [durationMinutes]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setIsRunning(false);
          setFeed((prevFeed) => [
            {
              id: crypto.randomUUID(),
              role: "aria",
              text: "Focus sprint complete. Take a short break and stretch.",
              ts: new Date().toISOString(),
            },
            ...prevFeed,
          ]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && isRunning) {
        setIsRunning(false);
        setFeed((prevFeed) => [
          {
            id: crypto.randomUUID(),
            role: "aria",
            text: "Tab-Sentry: timer paused. Stay in this tab to keep your focus streak alive.",
            ts: new Date().toISOString(),
          },
          ...prevFeed,
        ]);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isRunning]);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const { response, payload } = await apiFetch("/api/tasks", {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load tasks");
        }

        const rows = Array.isArray(payload?.todos) ? payload.todos : [];
        setTasks(rows);
      } catch (err) {
        setFeed((prevFeed) => [
          {
            id: crypto.randomUUID(),
            role: "aria",
            text: `Task sync failed: ${err.message}`,
            ts: new Date().toISOString(),
          },
          ...prevFeed,
        ]);
      }
    };

    loadTasks();
  }, []);

  const onCommandSubmit = async (event) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || isBusy) {
      return;
    }

    setFeed((prevFeed) => [
      {
        id: crypto.randomUUID(),
        role: "you",
        text: trimmed,
        ts: new Date().toISOString(),
      },
      ...prevFeed,
    ]);
    setCommand("");
    setIsBusy(true);

    try {
      const { response, payload } = await apiFetch("/api/aria", {
        method: "POST",
        body: JSON.stringify({ message: trimmed, text: trimmed, timerMinutes: durationMinutes }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Aria request failed");
      }

      if (payload?.intent === "[TIMER]" && payload?.command?.type === "START_TIMER") {
        const minutes = Number(payload?.command?.minutes || durationMinutes);
        const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(240, minutes)) : 25;
        setDurationMinutes(safeMinutes);
        setRemainingSeconds(safeMinutes * 60);
        setIsRunning(true);
      }

      const fallbackTasks = parseFallbackTasks(payload);
      if (fallbackTasks.length > 0) {
        setTasks(fallbackTasks);
      }

      setFeed((prevFeed) => [
        {
          id: crypto.randomUUID(),
          role: "aria",
          text: String(payload?.reply || "Aria returned no response."),
          ts: new Date().toISOString(),
        },
        ...prevFeed,
      ]);
    } catch (err) {
      setFeed((prevFeed) => [
        {
          id: crypto.randomUUID(),
          role: "aria",
          text: `Aria error: ${err.message}`,
          ts: new Date().toISOString(),
        },
        ...prevFeed,
      ]);
    } finally {
      setIsBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const progressPct = ((durationMinutes * 60 - remainingSeconds) / Math.max(1, durationMinutes * 60)) * 100;

  return (
    <div
      className="min-h-screen w-full px-4 pb-28 pt-6 text-zinc-100 md:px-8"
      style={{
        backgroundColor: "#0a0a0c",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(0,255,255,0.08), transparent 35%), radial-gradient(circle at 80% 25%, rgba(255,255,255,0.06), transparent 30%), radial-gradient(circle at 50% 90%, rgba(0,255,255,0.06), transparent 35%)",
      }}
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:grid-cols-12">
        <section className={`${GLASS_PANEL} p-5 md:col-span-3`}>
          <h2 className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">Microsoft To-Do</h2>
          <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "68vh" }}>
            {tasks.length === 0 ? (
              <p className="text-sm text-zinc-400">No tasks loaded.</p>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={task.isDone ? "text-zinc-500 line-through" : "text-zinc-100"}>{task.title}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        task.isDone ? "bg-zinc-700 text-zinc-300" : "bg-cyan-400/20 text-cyan-200"
                      }`}
                    >
                      {task.isDone ? "Done" : "Open"}
                    </span>
                  </div>
                  {task.dueDate ? <p className="mt-1 text-xs text-zinc-400">Due {task.dueDate}</p> : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className={`${GLASS_PANEL} p-6 md:col-span-6`}>
          <h2 className="mb-4 text-center text-sm uppercase tracking-[0.22em] text-cyan-200/80">Focus Core</h2>
          <div className="flex flex-col items-center justify-center">
            <div
              className="relative grid h-72 w-72 place-items-center rounded-full border border-cyan-300/35"
              style={{
                boxShadow:
                  "0 0 28px rgba(0,255,255,0.35), inset 0 0 42px rgba(0,255,255,0.18), 0 0 110px rgba(0,255,255,0.25)",
                background:
                  "radial-gradient(circle at 30% 20%, rgba(0,255,255,0.16), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.35) 100%)",
              }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full border-4 border-cyan-300/80"
                style={{
                  width: `${Math.max(0, Math.min(100, progressPct))}%`,
                  borderRight: "none",
                  borderTopLeftRadius: "999px",
                  borderBottomLeftRadius: "999px",
                  boxShadow: "0 0 20px rgba(0,255,255,0.55)",
                }}
              />
              <div className="relative z-10 text-center">
                <p className="font-mono text-6xl tracking-wider text-cyan-100">{formatTime(remainingSeconds)}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.28em] text-zinc-400">
                  {isRunning ? "In Session" : "Paused"}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsRunning((prev) => !prev)}
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/20"
              >
                {isRunning ? "Pause" : "Start"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRunning(false);
                  setRemainingSeconds(durationMinutes * 60);
                }}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10"
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <section className={`${GLASS_PANEL} p-5 md:col-span-3`}>
          <h2 className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">Aria Intelligence</h2>
          <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "68vh" }}>
            {feed.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100"
              >
                <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-zinc-400">{entry.role}</p>
                <p className="leading-relaxed text-zinc-100">{entry.text}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <form
        onSubmit={onCommandSubmit}
        className="fixed bottom-5 left-1/2 z-30 w-[min(860px,calc(100%-2rem))] -translate-x-1/2"
      >
        <div className="rounded-2xl border border-cyan-300/45 bg-[rgba(255,255,255,0.05)] p-2 backdrop-blur-xl shadow-[0_0_26px_rgba(0,255,255,0.25)] animate-glowPulse">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Aria Command Bar: summarize this PRD, humanize this update, start 50 min timer..."
              className="h-12 flex-1 rounded-xl border border-white/15 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-cyan-300/70"
            />
            <button
              type="submit"
              disabled={isBusy}
              className="h-12 rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
            >
              {isBusy ? "Thinking..." : "Dispatch"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
