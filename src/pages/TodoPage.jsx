import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

function titleForMode(mode, authenticated) {
  if (mode === "microsoft") {
    return authenticated ? "Microsoft To Do mode" : "Microsoft read-only mode";
  }
  return "Local Supabase tasks mode";
}

export default function TodoPage() {
  const [todos, setTodos] = useState([]);
  const [todoMode, setTodoMode] = useState("local");
  const [status, setStatus] = useState("Loading tasks...");
  const [auth, setAuth] = useState({ authenticated: false, user: null });
  const [msState, setMsState] = useState({ lists: [], selectedListId: "", readOnly: true });
  const [titleInput, setTitleInput] = useState("");
  const [dueDateInput, setDueDateInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const counts = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((t) => Boolean(t.isDone)).length;
    return { total, done, open: total - done };
  }, [todos]);

  async function refreshAuthStatus() {
    try {
      const { response, payload } = await apiFetch("/api/auth/microsoft/status", { method: "GET" });
      if (!response.ok) {
        setAuth({ authenticated: false, user: null });
        return false;
      }
      setAuth({ authenticated: Boolean(payload?.authenticated), user: payload?.user || null });
      return Boolean(payload?.authenticated);
    } catch (_error) {
      setAuth({ authenticated: false, user: null });
      return false;
    }
  }

  async function loadLocalTodos() {
    setStatus("Loading local tasks...");
    const { response, payload } = await apiFetch("/api/todos", { method: "GET" });
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load local tasks");
    }
    setTodos(Array.isArray(payload?.todos) ? payload.todos : []);
    setTodoMode("local");
    setStatus("Local tasks loaded.");
  }

  async function loadMicrosoftTodos(listId = "") {
    setStatus("Loading Microsoft To Do tasks...");
    const params = new URLSearchParams();
    if (listId) {
      params.set("listId", listId);
    }

    const { response, payload } = await apiFetch(
      `/api/microsoft-todo/tasks${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" }
    );

    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load Microsoft To Do tasks");
    }

    const lists = Array.isArray(payload?.lists) ? payload.lists : [];
    const selectedListId = String(payload?.selectedList?.id || listId || (lists[0]?.id || ""));

    setMsState({
      lists,
      selectedListId,
      readOnly: Boolean(payload?.readOnly),
    });
    setTodos(Array.isArray(payload?.todos) ? payload.todos : []);
    setTodoMode("microsoft");
    setStatus("Microsoft To Do tasks loaded.");
  }

  async function initializePage() {
    try {
      const isAuthenticated = await refreshAuthStatus();
      if (isAuthenticated) {
        await loadMicrosoftTodos();
      } else {
        await loadLocalTodos();
      }
    } catch (error) {
      setStatus(error.message || "Failed to load tasks");
    }
  }

  useEffect(() => {
    initializePage();
  }, []);

  async function addTodo() {
    const title = titleInput.trim();
    if (!title || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (todoMode === "microsoft") {
        const { response, payload } = await apiFetch("/api/microsoft-todo/tasks", {
          method: "POST",
          body: JSON.stringify({
            title,
            dueDate: dueDateInput || null,
            listId: msState.selectedListId || null,
          }),
        });
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to add Microsoft task");
        }
        await loadMicrosoftTodos(msState.selectedListId);
      } else {
        const { response, payload } = await apiFetch("/api/todos", {
          method: "POST",
          body: JSON.stringify({ title, dueDate: dueDateInput || null }),
        });
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to add task");
        }
        await loadLocalTodos();
      }

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
      if (todoMode === "microsoft") {
        const listId = todo?.microsoftTodo?.listId || msState.selectedListId;
        const { response, payload } = await apiFetch(
          `/api/microsoft-todo/tasks/${encodeURIComponent(todo.id)}?listId=${encodeURIComponent(listId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              isDone: !todo.isDone,
              listId,
              listName: todo?.microsoftTodo?.listName,
            }),
          }
        );
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update Microsoft task");
        }
        await loadMicrosoftTodos(msState.selectedListId);
      } else {
        const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isDone: !todo.isDone }),
        });
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update task");
        }
        await loadLocalTodos();
      }
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
      if (todoMode === "microsoft") {
        const listId = todo?.microsoftTodo?.listId || msState.selectedListId;
        const { response, payload } = await apiFetch(
          `/api/microsoft-todo/tasks/${encodeURIComponent(todo.id)}?listId=${encodeURIComponent(listId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ title, listId, listName: todo?.microsoftTodo?.listName }),
          }
        );
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to edit Microsoft task");
        }
        await loadMicrosoftTodos(msState.selectedListId);
      } else {
        const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to edit task");
        }
        await loadLocalTodos();
      }
    } catch (error) {
      setStatus(error.message || "Failed to edit task");
    }
  }

  async function removeTodo(todo) {
    try {
      if (todoMode === "microsoft") {
        const listId = todo?.microsoftTodo?.listId || msState.selectedListId;
        const { response, payload } = await apiFetch(
          `/api/microsoft-todo/tasks/${encodeURIComponent(todo.id)}?listId=${encodeURIComponent(listId)}`,
          {
            method: "DELETE",
            body: JSON.stringify({ listId, listName: todo?.microsoftTodo?.listName }),
          }
        );
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete Microsoft task");
        }
        await loadMicrosoftTodos(msState.selectedListId);
      } else {
        const { response, payload } = await apiFetch(`/api/todos/${todo.id}`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to delete task");
        }
        await loadLocalTodos();
      }
    } catch (error) {
      setStatus(error.message || "Failed to delete task");
    }
  }

  async function switchToMicrosoft() {
    try {
      const isAuthenticated = await refreshAuthStatus();
      if (!isAuthenticated) {
        window.location.href = `/api/auth/microsoft/login?next=${encodeURIComponent(window.location.href)}`;
        return;
      }
      await loadMicrosoftTodos(msState.selectedListId);
    } catch (error) {
      setStatus(error.message || "Unable to switch to Microsoft mode");
    }
  }

  async function logoutMicrosoft() {
    try {
      await apiFetch("/api/auth/microsoft/logout", { method: "POST" });
    } catch (_error) {
      // Ignore network issues and recover UI to local mode.
    }
    setAuth({ authenticated: false, user: null });
    await loadLocalTodos();
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
      <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-12">
        <div className={`${GLASS_PANEL} p-5 md:col-span-4`}>
          <h1 className="text-lg font-semibold tracking-wide text-cyan-100">To-Do Manager</h1>
          <p className="mt-1 text-sm text-zinc-400">{titleForMode(todoMode, auth.authenticated)}</p>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={loadLocalTodos}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10"
              >
                Local Tasks
              </button>
              <button
                type="button"
                onClick={switchToMicrosoft}
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-cyan-100 hover:bg-cyan-300/20"
              >
                Microsoft To Do
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={initializePage}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={logoutMicrosoft}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-zinc-200 hover:bg-white/10"
              >
                Microsoft Sign Out
              </button>
            </div>
          </div>

          {todoMode === "microsoft" ? (
            <div className="mt-4">
              <label htmlFor="ms-list" className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-400">
                List
              </label>
              <select
                id="ms-list"
                value={msState.selectedListId}
                onChange={(e) => {
                  const next = e.target.value;
                  setMsState((prev) => ({ ...prev, selectedListId: next }));
                  loadMicrosoftTodos(next);
                }}
                className="w-full rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-sm text-zinc-100"
              >
                {(msState.lists || []).map((list) => (
                  <option key={String(list.id)} value={String(list.id)}>
                    {list.displayName || "Unnamed list"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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
        </div>

        <div className={`${GLASS_PANEL} p-5 md:col-span-8`}>
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
              disabled={isSubmitting || (todoMode === "microsoft" && msState.readOnly)}
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
                      disabled={todoMode === "microsoft" && msState.readOnly}
                      onChange={() => toggleDone(todo)}
                      className="h-4 w-4 accent-cyan-300"
                    />
                    <span className={todo.isDone ? "text-zinc-500 line-through" : "text-zinc-100"}>{todo.title}</span>
                  </label>

                  <div className="text-xs text-zinc-400">{todo.dueDate ? `Due ${todo.dueDate}` : "No due date"}</div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={todoMode === "microsoft" && msState.readOnly}
                      onClick={() => editTodo(todo)}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-60"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={todoMode === "microsoft" && msState.readOnly}
                      onClick={() => removeTodo(todo)}
                      className="rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
