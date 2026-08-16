import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const handleSubmit = (event) => {
        event.preventDefault();

        if (!email.trim() || !password.trim()) {
            setError("Please enter both email and password.");
            return;
        }

        window.localStorage.setItem("sb-access-token", "demo-session");
        window.localStorage.setItem("supabaseAccessToken", "demo-session");
        setError("");
        navigate("/dashboard", { replace: true });
    };

    return (
        <main
            className="flex min-h-screen items-center justify-center bg-[#0a0a0c] px-6 text-zinc-100"
            style={{ fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" }}
        >
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <div className="text-cyan-400 text-2xl">&gt;_</div>
                <h1 className="mt-3 text-3xl font-mono text-cyan-300">Sign in</h1>
                <p className="mt-2 text-sm text-zinc-400">Access your Focus Buddy workspace.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <div className="space-y-2 text-left">
                        <label htmlFor="email" className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-[#111114] px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-cyan-400"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div className="space-y-2 text-left">
                        <label htmlFor="password" className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-[#111114] px-3 py-2 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-500 focus:border-cyan-400"
                            placeholder="Enter your password"
                        />
                    </div>

                    {error ? (
                        <p className="text-sm text-red-400">{error}</p>
                    ) : null}

                    <button
                        type="submit"
                        className="mt-2 w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-medium text-[#071017] transition hover:bg-cyan-300"
                    >
                        Login
                    </button>
                </form>
            </div>
        </main>
    );
}
