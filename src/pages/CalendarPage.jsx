import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

const HOLIDAY_COUNTRY = "IN";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseIsoToDateKey(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return toDateKey(dt);
}

export default function CalendarPage() {
  useDocumentTitleScramble("Focus Buddy | Task Calendar");

  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(new Date()));
  const [todos, setTodos] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [status, setStatus] = useState("Loading calendar data...");
  const [holidayCache, setHolidayCache] = useState({});

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(monthDate),
    [monthDate]
  );

  const holidayDateLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    []
  );

  const eventsMap = useMemo(() => {
    const map = new Map();

    for (const todo of todos) {
      const dateKey = parseIsoToDateKey(todo.createdAt || todo.updatedAt);
      if (!dateKey) continue;
      const list = map.get(dateKey) || [];
      list.push({ type: todo.isDone ? "done" : "todo", text: todo.title });
      map.set(dateKey, list);
    }

    for (const holiday of holidays) {
      const dateKey = String(holiday.date || "").trim();
      if (!dateKey) continue;
      const list = map.get(dateKey) || [];
      list.push({ type: "holiday", text: holiday.localName || holiday.name || "Holiday" });
      map.set(dateKey, list);
    }

    return map;
  }, [todos, holidays]);

  const calendarCells = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDayIdx = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells = [];
    for (let cell = 0; cell < 42; cell += 1) {
      let dateObj;
      let dayNumber;
      let otherMonth = false;

      if (cell < startDayIdx) {
        dayNumber = prevMonthDays - startDayIdx + cell + 1;
        dateObj = new Date(year, month - 1, dayNumber);
        otherMonth = true;
      } else if (cell >= startDayIdx + daysInMonth) {
        dayNumber = cell - (startDayIdx + daysInMonth) + 1;
        dateObj = new Date(year, month + 1, dayNumber);
        otherMonth = true;
      } else {
        dayNumber = cell - startDayIdx + 1;
        dateObj = new Date(year, month, dayNumber);
      }

      const dateKey = toDateKey(dateObj);
      cells.push({ dateObj, dateKey, dayNumber, otherMonth, events: eventsMap.get(dateKey) || [] });
    }
    return cells;
  }, [eventsMap, monthDate]);

  async function loadTodos() {
    const { response, payload } = await apiFetch("/api/todos", { method: "GET" });
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load tasks");
    }
    setTodos(Array.isArray(payload?.todos) ? payload.todos : []);
  }

  async function loadHolidays(year) {
    const cacheKey = `${year}:${HOLIDAY_COUNTRY}`;
    if (holidayCache[cacheKey]) {
      setHolidays(holidayCache[cacheKey]);
      return holidayCache[cacheKey];
    }

    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${HOLIDAY_COUNTRY}`);
    if (!response.ok) {
      throw new Error("Failed to fetch holidays");
    }

    const rows = await response.json();
    setHolidayCache((prev) => ({ ...prev, [cacheKey]: rows }));
    setHolidays(rows);
    return rows;
  }

  async function refreshCalendar() {
    const year = monthDate.getFullYear();
    setStatus("Loading tasks and holidays...");
    try {
      await loadTodos();
      const rows = await loadHolidays(year);
      setStatus(`Loaded calendar with ${rows.length} holiday(s) for India.`);
    } catch (error) {
      setStatus(error.message || "Could not load calendar data.");
      setHolidays([]);
      setTodos([]);
    }
  }

  useEffect(() => {
    refreshCalendar();
  }, [monthDate]);

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
          <h1 className="text-xl font-semibold text-cyan-100">Task Calendar</h1>
          <p className="mt-1 text-sm text-zinc-400">Calendar overlays task events and public holidays.</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              Prev
            </button>
            <div className="rounded-xl border border-white/20 bg-black/25 px-4 py-2 text-sm tracking-wide text-zinc-200">
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setSelectedDateKey(toDateKey(now));
                setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-300/20"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setHolidayCache({});
                refreshCalendar();
              }}
              className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          <p className="mt-3 text-xs text-zinc-400">{status}</p>
        </div>

        <div className={`${GLASS_PANEL} p-5`}>
          <div className="grid grid-cols-7 gap-2">
            {DOW.map((day) => (
              <div key={day} className="rounded-lg bg-white/5 px-2 py-1 text-center text-xs uppercase tracking-[0.14em] text-zinc-400">
                {day}
              </div>
            ))}

            {calendarCells.map((cell) => {
              const todayKey = toDateKey(new Date());
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDateKey;
              return (
                <button
                  type="button"
                  key={cell.dateKey + cell.dayNumber + String(cell.otherMonth)}
                  onClick={() => setSelectedDateKey(cell.dateKey)}
                  className={[
                    "min-h-28 rounded-xl border p-2 text-left transition",
                    cell.otherMonth ? "border-white/5 bg-black/20 text-zinc-500" : "border-white/10 bg-white/5 text-zinc-100",
                    isSelected ? "ring-2 ring-cyan-300/55" : "",
                    isToday && !isSelected ? "border-cyan-300/40" : "",
                  ].join(" ")}
                >
                  <div className="mb-1 text-xs font-semibold">{cell.dayNumber}</div>
                  <div className="space-y-1">
                    {cell.events.slice(0, 3).map((event, idx) => (
                      <div
                        key={`${cell.dateKey}-${idx}`}
                        className={[
                          "truncate rounded px-1.5 py-0.5 text-[10px]",
                          event.type === "holiday"
                            ? "border border-amber-300/55 bg-amber-300/15 text-amber-100"
                            : event.type === "done"
                              ? "border border-emerald-300/45 bg-emerald-300/12 text-emerald-100"
                              : "border border-cyan-300/45 bg-cyan-300/12 text-cyan-100",
                        ].join(" ")}
                        title={event.text}
                      >
                        {event.text}
                      </div>
                    ))}
                    {cell.events.length > 3 ? (
                      <div className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400">+{cell.events.length - 3} more</div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${GLASS_PANEL} p-5`}>
          <h2 className="text-sm uppercase tracking-[0.18em] text-zinc-300">Holidays In Selected Year</h2>
          {holidays.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">No holiday data loaded yet.</p>
          ) : (
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {[...holidays]
                .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                .map((holiday) => {
                  const date = new Date(`${holiday.date}T00:00:00`);
                  const label = Number.isNaN(date.getTime()) ? holiday.date : holidayDateLabel.format(date);
                  const name = holiday.localName || holiday.name || "Holiday";
                  return (
                    <li key={`${holiday.date}-${name}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="text-xs text-amber-100">{label}</div>
                      <div className="text-sm text-zinc-100">{name}</div>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
