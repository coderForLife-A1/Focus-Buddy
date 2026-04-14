import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import TopNav from "./components/TopNav";

const Dashboard = lazy(() => import("./components/Dashboard"));
const TodoPage = lazy(() => import("./pages/TodoPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const SummarizerPage = lazy(() => import("./pages/SummarizerPage"));

export default function App() {
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
          <Route path="/todo" element={<TodoPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/summarizer" element={<SummarizerPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
