import { motion } from "framer-motion";
import ContactDispatchCard from "../components/ContactDispatchCard";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

const panelStaggerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.16,
      delayChildren: 0.12,
    },
  },
};

const panelIntroVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 90,
      damping: 15,
    },
  },
};

export default function ContactPage() {
  useDocumentTitleScramble("Cipher | Dispatch Protocol");

  return (
    <section
      className="min-h-screen px-4 pb-10 pt-4 text-zinc-100 md:px-8"
      style={{
        backgroundColor: "#0a0a0c",
        backgroundImage:
          "radial-gradient(circle at 16% 10%, rgba(0,255,255,0.09), transparent 36%), radial-gradient(circle at 84% 22%, rgba(255,255,255,0.045), transparent 26%), radial-gradient(circle at 52% 92%, rgba(0,255,255,0.055), transparent 32%)",
      }}
    >
      <motion.div className="mx-auto max-w-7xl" variants={panelStaggerVariants} initial="hidden" animate="visible">
        <motion.header variants={panelIntroVariants} className="mb-4 grid gap-2 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] p-5 backdrop-blur-xl">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300/80">Cipher Contact Channel</p>
          <h1 className="font-mono text-xl text-cyan-100">Dispatch Console Variants</h1>
          <p className="font-mono text-sm text-zinc-400">
            High-fidelity terminal-glass Contact / Feedback mockup in three states for bento-grid placement.
          </p>
        </motion.header>

        <motion.div variants={panelStaggerVariants} className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <motion.article variants={panelIntroVariants} className="grid gap-2 xl:col-span-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">Variant / Default</div>
            <ContactDispatchCard previewState="default" />
          </motion.article>

          <motion.article variants={panelIntroVariants} className="grid gap-2 xl:col-span-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">Variant / Hover</div>
            <ContactDispatchCard previewState="hover" />
          </motion.article>

          <motion.article variants={panelIntroVariants} className="grid gap-2 xl:col-span-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">Variant / Active + Typing</div>
            <ContactDispatchCard
              previewState="active"
              alias="OP_47"
              pingAddress="operator@cipher-grid.dev"
              payload="Telemetry uplink verified. Requesting encrypted sprint feedback packet for module THETA-19."
            />
          </motion.article>
        </motion.div>
      </motion.div>
    </section>
  );
}
