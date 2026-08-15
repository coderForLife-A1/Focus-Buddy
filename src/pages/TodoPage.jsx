import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "../lib/api";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

const panelStaggerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.2,
    },
  },
};

const panelIntroVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 18,
    },
  },
};

export default function TodoPage() {
  useDocumentTitleScramble("Focus Buddy | Task Manager");

  const [todos, setTodos] = useState([]);
  const [status, setStatus] = useState("Loading tasks...");
  const [titleInput, setTitleInput] = useState("");
  const [dueDateInput, setDueDateInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const counts = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((t) => Boolean(t.isDone)).length;
    return { total, done, open: total - done };
  }, [todos]);

  async function loadLocalTodos() {
    setStatus("Loading tasks...");
    const { response, payload } = await apiFetch("/api/todos", { method: "GET" });
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load tasks");
    }
    setTodos(Array.isArray(payload?.todos) ? payload.todos : []);
    setStatus("Tasks loaded.");
  }

  useEffect(() => {
    loadLocalTodos().catch((error) => {
      setStatus(error.message || "Failed to load tasks");
    });
  }, []);

  async function addTodo() {
    const title = titleInput.trim();
    if (!title || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { response, payload } = await apiFetch("/api/todos", {
        method: "POST",
        body: JSON.stringify({ title, dueDate: dueDateInput || null }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to add task");
      }

      await loadLocalTodos();
      setTitleInput("");
      setDueDateInput("");
    } catch (error) {
      setStatus(error.message || "Failed to add task");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleDone(todo) {
    try {
      const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isDone: !todo.isDone }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update task");
      }

      await loadLocalTodos();
    } catch (error) {
      setStatus(error.message || "Failed to update task");
    }
  }

  async function editTodo(todo) {
    const next = window.prompt("Edit task", todo.title || "");
    if (next === null) {
      return;
    }

    const title = next.trim();
    if (!title) {
      setStatus("Task title cannot be empty.");
      return;
    }

    try {
      const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to edit task");
      }

      await loadLocalTodos();
    } catch (error) {
      setStatus(error.message || "Failed to edit task");
    }
  }

  async function removeTodo(todo) {
    try {
      const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete task");
      }
      await loadLocalTodos();
    } catch (error) {
      setStatus(error.message || "Failed to delete task");
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
      <motion.div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-12" variants={panelStaggerVariants} initial="hidden" animate="visible">
        <motion.div variants={panelIntroVariants} className={`${GLASS_PANEL} p-5 md:col-span-4`}>
          <h1 className="text-lg font-semibold tracking-wide text-cyan-100">To-Do Manager</h1>
          <p className="mt-1 text-sm text-zinc-400">Local task mode</p>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => loadLocalTodos().catch((error) => setStatus(error.message || "Failed to load tasks"))}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl border border-white/10 bg-white/5 py-2">
              <div className="text-lg font-semibold text-cyan-100">{counts.total}</div>
              <div className="text-zinc-400">Total</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 py-2">
              <div className="text-lg font-semibold text-cyan-100">{counts.open}</div>
              <div className="text-zinc-400">Open</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 py-2">
              <div className="text-lg font-semibold text-cyan-100">{counts.done}</div>
              <div className="text-zinc-400">Done</div>
            </div>
          </div>
        </motion.div>

        <motion.div variants={panelIntroVariants} className={`${GLASS_PANEL} p-5 md:col-span-8`}>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Add a task..."
              className="h-11 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
            <input
              value={dueDateInput}
              onChange={(e) => setDueDateInput(e.target.value)}
              type="date"
              className="h-11 rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-zinc-100"
            />
            <button
              type="button"
              disabled={isSubmitting}
              onClick={addTodo}
              className="h-11 rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
            >
              Add Task
            </button>
          </div>

          <p className="mt-3 text-xs text-zinc-400">{status}</p>

          <div className="mt-4 space-y-2">
            {todos.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-zinc-400">
                No tasks found.
              </div>
            ) : (
              todos.map((todo) => (
                <div
                  key={String(todo.id)}
                  className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 md:flex-row md:items-center"
                >
                  <label className="flex items-center gap-3 md:flex-1">
                    <input
                      type="checkbox"
                      checked={Boolean(todo.isDone)}
                      onChange={() => toggleDone(todo)}
                      className="h-4 w-4 accent-cyan-300"
                    />
                    <span className={todo.isDone ? "text-zinc-500 line-through" : "text-zinc-100"}>{todo.title}</span>
                  </label>

                  <div className="text-xs text-zinc-400">{todo.dueDate ? `Due ${todo.dueDate}` : "No due date"}</div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => editTodo(todo)}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTodo(todo)}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
