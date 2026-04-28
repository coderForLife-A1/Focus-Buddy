import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, supabaseError } from "../lib/supabase";

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    // If user is already authenticated, redirect to the stored target or dashboard
    useEffect(() => {
        const token = window.localStorage.getItem("sb-access-token") ||
            Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
        if (token) {
            const redirectTarget = window.localStorage.getItem("login-redirect-target") || "/";
            window.localStorage.removeItem("login-redirect-target");
            navigate(redirectTarget, { replace: true });
        }
    }, [navigate]);

    async function handleMicrosoftLogin() {
        if (!supabase) {
            console.error(supabaseError);
            return;
        }
        // Store current location for redirect after OAuth callback
        const nextPage = window.location.search ? new URLSearchParams(window.location.search).get("next") : null;
        window.localStorage.setItem("login-redirect-target", nextPage || "/");

        setIsLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "azure",
                options: {
                    redirectTo: `${window.location.origin}/login`,
                    scopes: "openid profile email offline_access Tasks.ReadWrite",
                },
            });

            if (error) {
                console.error("Microsoft uplink initiation failed:", error.message);
                setIsLoading(false);
            }
        } catch (err) {
            console.error("Unexpected OAuth error:", err);
            setIsLoading(false);
        }
    }

    // Show error if Supabase isn't initialized
    if (supabaseError) {
        return (
            <main className="h-screen w-full flex items-center justify-center bg-[#0a0a0c] text-zinc-100">
                <div className="max-w-lg p-8 border border-red-500/50 bg-red-500/5 rounded-lg">
                    <h1 className="text-2xl font-mono text-red-400 mb-4">[ SYSTEM ERROR ]</h1>
                    <p className="text-sm text-red-300 mb-4 font-mono">{supabaseError}</p>
                    <p className="text-xs text-zinc-400">
                        Create a <code className="bg-black/50 px-2 py-1 rounded">.env.local</code> file in the project root with:<br />
                        <code className="block bg-black/50 p-2 rounded mt-2">VITE_SUPABASE_URL=your_url<br />VITE_SUPABASE_ANON_KEY=your_key</code>
                    </p>
                </div>
            </main>
        );
    }

    const systemCards = [
        { id: 1, title: "[MODULE_ACTIVE] Focus Core:", body: "Enforcing strict sprint parameters." },
        { id: 2, title: "[MODULE_STANDBY] Velocity Engine:", body: "Awaiting task delta from Microsoft Graph." },
        { id: 3, title: "[SECURITY] End-to-end encryption verified:", body: "via Supabase Auth." },
    ];

    return (
        <main
            className="h-screen w-full grid grid-cols-1 lg:grid-cols-2 bg-[#0a0a0c] text-zinc-100"
            style={{ fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" }}
        >
            {/* Left: Auth Gateway */}
            <div className="flex flex-col justify-center p-12">
                <div className="max-w-lg">
                    <div className="flex items-center gap-3">
                        <div className="text-cyan-400 text-3xl">&gt;_</div>
                        <h1 className="text-3xl font-mono text-cyan-400">&gt; CIPHER_SYSTEM_AUTH</h1>
                    </div>

                    <p className="mt-4 text-sm text-zinc-500">
                        Secure Microsoft To-Do handshake required to establish telemetry.
                    </p>

                    <div>
                        <button
                            type="button"
                            onClick={handleMicrosoftLogin}
                            disabled={isLoading}
                            className="mt-8 w-full py-3 rounded border border-cyan-500 text-cyan-400 font-mono text-sm tracking-wider transition-all duration-200 hover:bg-cyan-500/10 hover:shadow-[0_0_15px_rgba(0,255,255,0.3)] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isLoading ? "[ ESTABLISHING LINK... ]" : "[ INITIATE MICROSOFT UPLINK ]"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Right: Telemetry Marquee - hidden on mobile */}
            <div
                className="relative hidden lg:flex items-center justify-center overflow-hidden"
                style={{ WebkitMaskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)", maskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)" }}
            >
                <div className="w-full flex items-center justify-center">
                    <div className="h-[70%] w-full flex items-start justify-center">
                        <div className="w-full flex flex-col items-center">
                            <div className="w-full animate-marquee-vertical">
                                {[0, 1].map((rep) => (
                                    <div key={rep} className="flex flex-col items-center">
                                        {systemCards.map((card) => (
                                            <div key={`${rep}-${card.id}`} className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-lg mb-4 w-3/4 text-left">
                                                <div className="font-mono text-sm text-cyan-300">{card.title}</div>
                                                <div className="mt-2 text-sm text-zinc-300">{card.body}</div>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
