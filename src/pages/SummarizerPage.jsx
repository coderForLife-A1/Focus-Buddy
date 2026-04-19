import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "../lib/api";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

let pdfJsModulePromise = null;
let jsPdfModulePromise = null;

async function getPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      return module;
    });
  }
  return pdfJsModulePromise;
}

async function getJsPdfCtor() {
  if (!jsPdfModulePromise) {
    jsPdfModulePromise = import("jspdf").then((module) => module.jsPDF);
  }
  return jsPdfModulePromise;
}

const GLASS_PANEL =
  "rounded-3xl border border-white/10 bg-[rgba(255,255,255,0.03)] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.45)]";

const panelStaggerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.2,
    },
  },
};

const panelIntroVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 18,
    },
  },
};

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatProviderName(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (!normalized) return "server AI";
  if (normalized === "openai") return "OpenAI";
  if (normalized === "openrouter") return "OpenRouter";
  if (normalized === "gemini") return "Gemini";
  if (normalized === "claude") return "Claude";
  if (normalized === "local") return "local fallback";
  return normalized;
}

async function extractTextFromPdf(file) {
  const pdfjsLib = await getPdfJsModule();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const chunks = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    chunks.push(textContent.items.map((item) => item.str).join(" "));
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export default function SummarizerPage() {
  useDocumentTitleScramble("Focus Buddy | AI Summarizer");

  const [file, setFile] = useState(null);
  const [textInput, setTextInput] = useState("");
  const [ratio, setRatio] = useState(25);
  const [status, setStatus] = useState("Waiting for input.");
  const [summary, setSummary] = useState("Your generated summary will appear here.");
  const [stats, setStats] = useState({ sourceSentences: 0, summarySentences: 0, sourceWords: 0 });
  const [busy, setBusy] = useState(false);

  const ratioLabel = useMemo(() => `${ratio}%`, [ratio]);

  async function getSourceText() {
    const pasted = textInput.replace(/\s+/g, " ").trim();
    if (pasted) {
      setStatus("Using pasted text input.");
      return pasted;
    }

    if (!file) {
      return "";
    }

    const fileName = String(file.name || "").toLowerCase();
    if (fileName.endsWith(".pdf")) {
      setStatus("Reading PDF content...");
      return extractTextFromPdf(file);
    }

    setStatus("Reading text file content...");
    const plain = await file.text();
    return String(plain || "").replace(/\s+/g, " ").trim();
  }

  async function runSummarizer() {
    if (busy) return;
    setBusy(true);
    setStatus("Preparing summary...");

    try {
      const sourceText = await getSourceText();
      if (!sourceText) {
        setStatus("Please upload a PDF/text file or paste text first.");
        return;
      }

      const { response, payload } = await apiFetch("/api/ai-summarize", {
        method: "POST",
        body: JSON.stringify({ text: sourceText, ratioPercent: ratio }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Backend summarization failed");
      }

      const resultSummary = String(payload?.summary || "").trim();
      if (!resultSummary) {
        setSummary("No summary available.");
        setStats({ sourceSentences: 0, summarySentences: 0, sourceWords: 0 });
        setStatus("Could not generate a summary from the provided content.");
        return;
      }

      setSummary(resultSummary);
      setStats({
        sourceSentences: Number(payload?.sourceSentences || 0),
        summarySentences: Number(payload?.summarySentences || splitSentences(resultSummary).length),
        sourceWords: Number(payload?.sourceWords || 0),
      });

      if (payload?.usedFallback) {
        const err = payload?.aiError || {};
        const details = [];
        if (err.status) details.push(`status ${err.status}`);
        if (err.reason) details.push(String(err.reason));
        const detailText = details.length ? ` (${details.join(" - ")})` : "";
        const providerText = formatProviderName(err.provider || payload?.provider);
        setStatus(`Summary generated using local fallback. Upstream: ${providerText}${detailText}.`);
      } else {
        const providerText = formatProviderName(payload?.provider);
        if (String(payload?.provider || "").toLowerCase() === "openrouter") {
          setStatus("Summary generated.");
        } else {
          setStatus(`Summary generated by ${providerText}.`);
        }
      }
    } catch (error) {
      setStatus(error.message || "Unable to summarize right now.");
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setFile(null);
    setTextInput("");
    setSummary("Your generated summary will appear here.");
    setStatus("Waiting for input.");
    setStats({ sourceSentences: 0, summarySentences: 0, sourceWords: 0 });
  }

  async function copySummary() {
    const text = summary.trim();
    if (!text || text === "Your generated summary will appear here." || text === "No summary available.") {
      setStatus("Generate a summary before copying.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatus("Summary copied to clipboard.");
    } catch (_error) {
      setStatus("Could not copy summary. Please copy manually.");
    }
  }

  async function downloadSummaryAsPdf() {
    const text = summary.trim();
    if (!text || text === "Your generated summary will appear here." || text === "No summary available.") {
      setStatus("Generate a summary before downloading PDF.");
      return;
    }

    const JsPdfCtor = await getJsPdfCtor();
    const doc = new JsPdfCtor({ unit: "pt", format: "a4" });
    const margin = 40;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const now = new Date();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("AI Summary", margin, 52);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${now.toLocaleString()}`, margin, 70);

    doc.setFontSize(12);
    const lines = doc.splitTextToSize(text, width);
    let y = 95;
    const pageHeight = doc.internal.pageSize.getHeight();

    for (const line of lines) {
      if (y > pageHeight - 45) {
        doc.addPage();
        y = 50;
      }
      doc.text(line, margin, y);
      y += 17;
    }

    doc.save(`ai-summary-${Date.now()}.pdf`);
    setStatus("Summary PDF downloaded.");
  }

  return (
    <section
      className="min-h-screen px-4 pb-10 pt-4 text-zinc-100 md:px-8"
      style={{
        backgroundColor: "#0a0a0c",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(0,255,255,0.08), transparent 35%), radial-gradient(circle at 80% 25%, rgba(255,255,255,0.06), transparent 30%), radial-gradient(circle at 50% 90%, rgba(0,255,255,0.06), transparent 35%)",
      }}
    >
      <motion.div className="mx-auto grid max-w-7xl gap-4" variants={panelStaggerVariants} initial="hidden" animate="visible">
        <motion.div variants={panelIntroVariants} className={`${GLASS_PANEL} p-5`}>
          <h1 className="text-xl font-semibold text-cyan-100">AI Summarizer</h1>
          <p className="mt-1 text-sm text-zinc-400">Upload a PDF/text file, or paste text, and generate concise summaries.</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".pdf,.txt,.md,.text,.log"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="max-w-xs rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-sm text-zinc-200"
            />
            <label className="text-sm text-zinc-300">Summary Length</label>
            <input
              type="range"
              min={10}
              max={50}
              value={ratio}
              onChange={(e) => setRatio(Number(e.target.value))}
              className="w-40"
            />
            <span className="text-sm text-cyan-100">{ratioLabel}</span>
            <button
              type="button"
              disabled={busy}
              onClick={runSummarizer}
              className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
            >
              Summarize
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10"
            >
              Clear
            </button>
          </div>

          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Paste any article, notes, meeting transcript, or report text here..."
            className="mt-4 min-h-48 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500"
          />

          <p className="mt-3 text-xs text-zinc-400">{status}</p>

          <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-zinc-300">
              Source sentences: <span className="text-cyan-100">{stats.sourceSentences}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-zinc-300">
              Summary sentences: <span className="text-cyan-100">{stats.summarySentences}</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-zinc-300">
              Source words: <span className="text-cyan-100">{stats.sourceWords}</span>
            </div>
          </div>
        </motion.div>

        <motion.div variants={panelIntroVariants} className={`${GLASS_PANEL} p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm uppercase tracking-[0.18em] text-zinc-300">Summary</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copySummary}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
              >
                Copy Summary
              </button>
              <button
                type="button"
                onClick={downloadSummaryAsPdf}
                className="rounded-xl border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
              >
                Download as PDF
              </button>
            </div>
          </div>
          <div className="min-h-56 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-relaxed text-zinc-100">
            {summary}
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
