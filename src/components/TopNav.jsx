import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/", label: "Dashboard" },
  { to: "/history", label: "History" },
  { to: "/todo", label: "To-Do" },
  { to: "/calendar", label: "Calendar" },
  { to: "/summarizer", label: "Summarizer" },
];

export default function TopNav() {
  return (
    <nav className="mx-auto mb-4 flex w-full max-w-7xl flex-wrap gap-2 px-4 pt-4 md:px-8">
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
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
