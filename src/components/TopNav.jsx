import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import TextScramble from "./TextScramble";
import { supabase, supabaseError } from "../lib/supabase";

const tabs = [
  { to: "/", label: "Dashboard" },
  { to: "/velocity", label: "Velocity" },
  { to: "/history", label: "History" },
  { to: "/todo", label: "To-Do" },
  { to: "/calendar", label: "Calendar" },
  { to: "/summarizer", label: "Summarizer" },
  { to: "/contact", label: "Contact" },
];

export default function TopNav() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      const token = window.localStorage.getItem("sb-access-token") ||
        Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
      setIsAuthenticated(!!token);
    };
    checkAuth();
  }, []);

  async function handleLogout() {
    if (!supabase) {
      console.error("Supabase not initialized");
      return;
    }
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <nav className="mx-auto mb-4 flex w-full max-w-7xl items-center justify-between px-4 pt-4 md:px-8">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              [
                "rounded-full border px-4 py-1.5 text-xs tracking-[0.16em] uppercase transition",
                isActive
                  ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                  : "border-white/15 bg-white/5 text-zinc-300 hover:border-cyan-300/40 hover:text-cyan-100",
              ].join(" ")
            }
          >
            <TextScramble text={tab.label.toUpperCase()} />
          </NavLink>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {isAuthenticated && (
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="rounded-full border border-red-500/50 px-3 py-1.5 text-xs tracking-[0.16em] uppercase text-red-400 transition hover:border-red-500 hover:bg-red-500/10 disabled:opacity-50"
          >
            {isLoggingOut ? "[ LOGGING OUT ]" : "[ LOGOUT ]"}
          </button>
        )}
        {!isAuthenticated && (
          <NavLink
            to="/login"
            className="rounded-full border border-cyan-500/50 px-3 py-1.5 text-xs tracking-[0.16em] uppercase text-cyan-400 transition hover:border-cyan-500 hover:bg-cyan-500/10"
          >
            [ LOGIN ]
          </NavLink>
        )}
      </div>
    </nav>
  );
}
