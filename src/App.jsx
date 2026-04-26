import { useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import { resetScramblePlayed } from "./lib/scramble";

const Dashboard = lazy(() => import("./components/Dashboard"));
const VelocityDashboard = lazy(() => import("./components/VelocityDashboard"));
const TodoPage = lazy(() => import("./pages/TodoPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const SummarizerPage = lazy(() => import("./pages/SummarizerPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));

function ResetIntroRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    resetScramblePlayed();
    const timeout = window.setTimeout(() => {
      navigate("/", { replace: true });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [navigate]);

  return <Navigate to="/" replace />;
}

export default function App() {
  useEffect(() => {
    const resetOnExit = () => {
      resetScramblePlayed();
    };

    window.addEventListener("beforeunload", resetOnExit);
    window.addEventListener("pagehide", resetOnExit);

    return () => {
      window.removeEventListener("beforeunload", resetOnExit);
      window.removeEventListener("pagehide", resetOnExit);
      resetOnExit();
    };
  }, []);

  return (
    <BrowserRouter>
      <TopNav />
      <Suspense
        fallback={
          <div className="px-6 py-10 text-sm text-zinc-400">
            Loading page...
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/velocity" element={<VelocityDashboard />} />
          <Route path="/todo" element={<TodoPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/summarizer" element={<SummarizerPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/reset-intro" element={<ResetIntroRoute />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
