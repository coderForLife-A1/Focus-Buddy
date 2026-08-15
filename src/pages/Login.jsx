import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
    const navigate = useNavigate();

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            navigate("/dashboard", { replace: true });
        }, 250);

        return () => window.clearTimeout(timeout);
    }, [navigate]);

    return (
        <main
            className="flex min-h-screen items-center justify-center bg-[#0a0a0c] px-6 text-zinc-100"
            style={{ fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" }}
        >
            <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <div className="text-cyan-400 text-2xl">&gt;_</div>
                <h1 className="mt-3 text-2xl font-mono text-cyan-300">LOCAL MODE ACTIVE</h1>
                <p className="mt-4 text-sm text-zinc-400">
                    Microsoft link removed. Focus Buddy is running in local task-manager mode.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">redirecting to dashboard...</p>
            </div>
        </main>
    );
}
