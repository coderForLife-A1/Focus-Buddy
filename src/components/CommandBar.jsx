import { motion } from "framer-motion";
import TextScramble from "./TextScramble";

const commandBarVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.24,
            delay: 1.05,
            ease: [0.22, 1, 0.36, 1],
        },
    },
};

export default function CommandBar({
    command,
    onCommandChange,
    onSubmit,
    isBusy,
    mode,
    wakeWordStatus,
    wakeWordSupported,
    inputRef,
    canRunCommandBarScan,
    runCommandBarScan,
    onIntroComplete,
}) {
    const pulseClass =
        mode === "thinking"
            ? "animate-neural-pulse-slow"
            : mode === "speaking"
                ? "animate-neural-pulse-fast"
                : "";

    const badgePulseClass =
        mode === "thinking"
            ? "animate-neural-badge-slow"
            : mode === "speaking"
                ? "animate-neural-badge-fast"
                : "";

    return (
        <motion.form
            onSubmit={onSubmit}
            className="fixed bottom-5 inset-x-0 z-30 flex justify-center px-4"
            variants={commandBarVariants}
            initial="hidden"
            animate="visible"
            onAnimationComplete={onIntroComplete}
        >
            <div
                className={`relative w-full max-w-[860px] overflow-hidden rounded-2xl border border-cyan-300/45 bg-[rgba(255,255,255,0.05)] p-2 backdrop-blur-xl shadow-[0_0_26px_rgba(0,255,255,0.25)] transition-[opacity] duration-200 ${pulseClass}`}
            >
                {canRunCommandBarScan ? (
                    <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute left-0 top-0 h-px w-28 bg-gradient-to-r from-transparent via-cyan-200/95 to-transparent transition-transform duration-700 ease-linear ${runCommandBarScan ? "translate-x-[420%]" : "-translate-x-[140%]"
                            }`}
                    />
                ) : null}

                <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100/75">
                    <span>
                        <TextScramble text={wakeWordStatus} />
                    </span>
                    <span
                        className={`rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-100 transition-opacity duration-200 ${badgePulseClass}`}
                    >
                        <TextScramble text={wakeWordSupported ? "HEY CIPHER ARMED" : "WAKE WORD UNAVAILABLE"} />
                    </span>
                </div>

                <div className="relative flex items-center gap-2">
                    {command ? null : (
                        <div className="pointer-events-none absolute left-4 right-24 top-1/2 -translate-y-1/2 select-none overflow-hidden text-sm text-zinc-500">
                            <TextScramble text="Cipher Command Bar: summarize this PRD, humanize this update, start 50 min timer..." />
                        </div>
                    )}

                    <input
                        ref={inputRef}
                        value={command}
                        onChange={onCommandChange}
                        placeholder=""
                        className="h-12 flex-1 rounded-xl border border-white/15 bg-black/30 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-cyan-300/70"
                    />

                    <button
                        type="submit"
                        disabled={isBusy}
                        className="h-12 rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                    >
                        <TextScramble text={isBusy ? "THINKING..." : "DISPATCH"} />
                    </button>
                </div>
            </div>
        </motion.form>
    );
}
