import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
    const [isLoading, setIsLoading] = useState(false);

    async function handleLogin() {
        setIsLoading(true);

        const { error } = await supabase.auth.signInWithOAuth({
            provider: "azure",
            options: {
                redirectTo: `${window.location.origin}/todo`,
                scopes: "openid profile email offline_access Tasks.ReadWrite",
                queryParams: {
                    prompt: "select_account",
                },
            },
        });

        if (error) {
            console.error("Microsoft uplink initiation failed:", error.message);
            setIsLoading(false);
        }
    }

    return (
        <main className="min-h-screen w-full bg-[#0a0a0c] text-zinc-100">
            <div className="flex min-h-screen items-center justify-center px-4 py-8">
                <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/50 backdrop-blur-md sm:p-10">
                    <p className="font-mono text-2xl uppercase tracking-[0.14em] text-zinc-100 sm:text-3xl">
                        {"> CIPHER_SYSTEM_AUTH"}
                    </p>
                    <p className="mt-4 text-sm text-zinc-400 sm:text-base">
                        Secure Microsoft To-Do integration required.
                    </p>

                    <button
                        type="button"
                        onClick={handleLogin}
                        disabled={isLoading}
                        className="mt-8 w-full rounded-lg border border-cyan-500 px-4 py-3 font-mono text-sm tracking-[0.15em] text-cyan-400 transition-all duration-200 hover:bg-cyan-500/10 hover:shadow-[0_0_24px_rgba(6,182,212,0.4)] disabled:cursor-not-allowed disabled:border-cyan-900 disabled:text-cyan-700 disabled:hover:bg-transparent disabled:hover:shadow-none"
                    >
                        {isLoading ? "[ ESTABLISHING LINK... ]" : "[ INITIATE MICROSOFT UPLINK ]"}
                    </button>
                </section>
            </div>
        </main>
    );
}
