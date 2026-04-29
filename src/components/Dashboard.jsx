import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { apiFetch } from "../lib/api";
import CommandBar from "./CommandBar";
import TextScramble from "./TextScramble";
import useDocumentTitleScramble from "../hooks/useDocumentTitleScramble";

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

const COMMAND_BAR_SCAN_SESSION_KEY = "cipher-command-bar-scan-v1";

function formatTime(seconds) {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const remainder = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function parseFallbackTasks(payload) {
  if (Array.isArray(payload?.tasks)) {
    return payload.tasks;
  }
  if (Array.isArray(payload?.todos)) {
    return payload.todos;
  }
  if (Array.isArray(payload?.data?.tasks)) {
    return payload.data.tasks;
  }
  return [];
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function normalizeSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWakeWord(transcript) {
  const original = String(transcript || "").trim();
  const normalized = normalizeSpeech(original);
  const wakePhrase = "hey cipher";
  const wakeIndex = normalized.indexOf(wakePhrase);

  if (wakeIndex === -1) {
    return "";
  }

  return original.replace(/^[\s,.:;!?-]*hey\s+cipher[\s,.:;!?-]*/i, "").trim();
}

export default function Dashboard() {
  useDocumentTitleScramble("Focus Buddy | Cipher Dashboard");
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [feed, setFeed] = useState([
    {
      id: "boot-1",
      role: "cipher",
      text: "Cipher online. Ask for summaries, humanized text, or timer commands.",
      ts: new Date().toISOString(),
    },
  ]);
  const [command, setCommand] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [commandBarMode, setCommandBarMode] = useState("idle");
  const [wakeWordStatus, setWakeWordStatus] = useState("Waiting for Hey Cipher");
  const [wakeWordSupported, setWakeWordSupported] = useState(true);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const wakeWordActiveRef = useRef(false);
  const pendingVoiceCommandRef = useRef("");
  const restartRecognitionRef = useRef(null);
  const recognitionRunningRef = useRef(false);
  const userGestureArmedRef = useRef(false);
  const speechStartRef = useRef(() => { });
  const typingIntervalRef = useRef(null);
  const [canRunCommandBarScan, setCanRunCommandBarScan] = useState(false);
  const [runCommandBarScan, setRunCommandBarScan] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem("sb-access-token") ||
      Object.keys(window.localStorage).find(key => key.startsWith("sb-") && key.endsWith("-auth-token"));
    if (!token) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    setRemainingSeconds(durationMinutes * 60);
  }, [durationMinutes]);

  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) {
        window.clearInterval(typingIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const hasPlayed = window.sessionStorage.getItem(COMMAND_BAR_SCAN_SESSION_KEY) === "1";
      setCanRunCommandBarScan(!hasPlayed);
    } catch (_error) {
      setCanRunCommandBarScan(true);
    }
  }, []);

  useEffect(() => {
    if (!runCommandBarScan) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setRunCommandBarScan(false);
      setCanRunCommandBarScan(false);
      try {
        window.sessionStorage.setItem(COMMAND_BAR_SCAN_SESSION_KEY, "1");
      } catch (_error) {
        // Ignore session storage write failures.
      }
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [runCommandBarScan]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setIsRunning(false);
          setFeed((prevFeed) => [
            {
              id: crypto.randomUUID(),
              role: "cipher",
              text: "Focus sprint complete. Take a short break and stretch.",
              ts: new Date().toISOString(),
            },
            ...prevFeed,
          ]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && isRunning) {
        setIsRunning(false);
        setFeed((prevFeed) => [
          {
            id: crypto.randomUUID(),
            role: "cipher",
            text: "Tab-Sentry: timer paused. Stay in this tab to keep your focus streak alive.",
            ts: new Date().toISOString(),
          },
          ...prevFeed,
        ]);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isRunning]);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const { response, payload } = await apiFetch("/api/tasks", {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load tasks");
        }

        const rows = Array.isArray(payload?.todos) ? payload.todos : [];
        setTasks(rows);
      } catch (err) {
        setFeed((prevFeed) => [
          {
            id: crypto.randomUUID(),
            role: "cipher",
            text: `Task sync failed: ${err.message}`,
            ts: new Date().toISOString(),
          },
          ...prevFeed,
        ]);
      }
    };

    loadTasks();
  }, []);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) {
      setWakeWordSupported(false);
      setWakeWordStatus("Wake word unavailable in this browser");
      return undefined;
    }

    setWakeWordSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let shouldRestart = true;

    const startRecognition = () => {
      if (!shouldRestart || recognitionRunningRef.current) {
        return;
      }

      try {
        recognition.start();
      } catch (_error) {
        setWakeWordStatus("Microphone not ready. Click Enable Mic.");
      }
    };

    speechStartRef.current = startRecognition;

    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setWakeWordStatus(wakeWordActiveRef.current ? "Listening for command" : "Waiting for Hey Cipher");
    };

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal) {
          continue;
        }

        const transcript = String(result[0]?.transcript || "").trim();
        if (!transcript) {
          continue;
        }

        if (!wakeWordActiveRef.current) {
          const voiceCommand = stripWakeWord(transcript);
          if (!normalizeSpeech(transcript).includes("hey cipher")) {
            continue;
          }

          wakeWordActiveRef.current = true;
          pendingVoiceCommandRef.current = voiceCommand;
          setWakeWordStatus("Hey Cipher heard. Listening.");
          setFeed((prevFeed) => [
            {
              id: crypto.randomUUID(),
              role: "cipher",
              text: "Wake word detected. Listening.",
              ts: new Date().toISOString(),
            },
            ...prevFeed,
          ]);

          if (voiceCommand) {
            setCommand(voiceCommand);
          }
          continue;
        }

        pendingVoiceCommandRef.current = [pendingVoiceCommandRef.current, transcript].filter(Boolean).join(" ").trim();
        if (pendingVoiceCommandRef.current) {
          setCommand(pendingVoiceCommandRef.current);
        }
      }
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;

      if (wakeWordActiveRef.current) {
        const voiceCommand = pendingVoiceCommandRef.current.trim();
        if (voiceCommand) {
          setCommand(voiceCommand);
          setWakeWordStatus("Voice captured. Press Dispatch to send.");
        } else {
          setWakeWordStatus("Wake detected, but no command captured.");
        }
        pendingVoiceCommandRef.current = "";
        wakeWordActiveRef.current = false;
      }

      if (!shouldRestart || !userGestureArmedRef.current) {
        return;
      }

      restartRecognitionRef.current = window.setTimeout(() => {
        startRecognition();
      }, 250);
    };

    recognition.onerror = (event) => {
      recognitionRunningRef.current = false;
      const code = String(event?.error || "unknown").toLowerCase();

      if (code === "not-allowed" || code === "service-not-allowed") {
        setWakeWordStatus("Microphone blocked. Click Enable Mic and allow access.");
        wakeWordActiveRef.current = false;
        pendingVoiceCommandRef.current = "";
        return;
      }

      if (code === "no-speech" || code === "aborted") {
        setWakeWordStatus("Listening paused. Waiting for Hey Cipher");
        return;
      }

      setWakeWordStatus(`Wake word error: ${String(event?.error || "unknown")}`);
    };

    recognitionRef.current = recognition;
    setWakeWordStatus("Click Enable Mic, then say Hey Cipher");

    const onUserGesture = () => {
      userGestureArmedRef.current = true;
      startRecognition();
    };

    window.addEventListener("pointerdown", onUserGesture, { once: true });

    return () => {
      shouldRestart = false;
      if (restartRecognitionRef.current) {
        window.clearTimeout(restartRecognitionRef.current);
      }
      window.removeEventListener("pointerdown", onUserGesture);
      try {
        recognition.stop();
      } catch (_error) {
        // Ignore shutdown errors.
      }
      recognitionRunningRef.current = false;
      recognitionRef.current = null;
    };
  }, []);

  const submitCipherCommand = async (rawCommand) => {
    const trimmed = String(rawCommand || "").trim();
    if (!trimmed || isBusy) {
      return;
    }

    setFeed((prevFeed) => [
      {
        id: crypto.randomUUID(),
        role: "you",
        text: trimmed,
        ts: new Date().toISOString(),
      },
      ...prevFeed,
    ]);
    setCommand("");
    setIsBusy(true);
    setCommandBarMode("thinking");

    const streamReplyToFeed = (text) =>
      new Promise((resolve) => {
        const content = String(text || "Cipher returned no response.");
        const entryId = crypto.randomUUID();

        setFeed((prevFeed) => [
          {
            id: entryId,
            role: "cipher",
            text: "",
            ts: new Date().toISOString(),
          },
          ...prevFeed,
        ]);

        if (!content) {
          setCommandBarMode("idle");
          resolve();
          return;
        }

        let cursor = 0;
        const step = Math.max(1, Math.ceil(content.length / 48));
        setCommandBarMode("speaking");

        typingIntervalRef.current = window.setInterval(() => {
          cursor += step;
          const frame = content.slice(0, cursor);

          setFeed((prevFeed) =>
            prevFeed.map((entry) => (entry.id === entryId ? { ...entry, text: frame } : entry))
          );

          if (cursor >= content.length) {
            if (typingIntervalRef.current) {
              window.clearInterval(typingIntervalRef.current);
              typingIntervalRef.current = null;
            }
            setCommandBarMode("idle");
            resolve();
          }
        }, 24);
      });

    try {
      const { response, payload } = await apiFetch("/api/cipher", {
        method: "POST",
        body: JSON.stringify({ message: trimmed, text: trimmed, timerMinutes: durationMinutes }),
      });

      if (!response.ok) {
        throw new Error(payload?.error || "Cipher request failed");
      }

      const timerAction = String(payload?.command?.action || payload?.command?.type || "").toUpperCase();
      if (payload?.intent === "[TIMER]" && timerAction === "START_TIMER") {
        const minutes = Number(payload?.command?.duration || payload?.command?.minutes || durationMinutes);
        const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(240, minutes)) : 25;
        setDurationMinutes(safeMinutes);
        setRemainingSeconds(safeMinutes * 60);
        setIsRunning(true);
      }

      const fallbackTasks = parseFallbackTasks(payload);
      if (fallbackTasks.length > 0) {
        setTasks(fallbackTasks);
      }

      await streamReplyToFeed(payload?.reply);
    } catch (err) {
      setCommandBarMode("idle");
      setFeed((prevFeed) => [
        {
          id: crypto.randomUUID(),
          role: "cipher",
          text: `Cipher error: ${err.message}`,
          ts: new Date().toISOString(),
        },
        ...prevFeed,
      ]);
    } finally {
      setIsBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const onCommandSubmit = async (event) => {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || isBusy) {
      return;
    }

    await submitCipherCommand(trimmed);
  };

  const progressPct = ((durationMinutes * 60 - remainingSeconds) / Math.max(1, durationMinutes * 60)) * 100;

  const handleCommandBarIntroComplete = () => {
    if (!canRunCommandBarScan || runCommandBarScan) {
      return;
    }
    setRunCommandBarScan(true);
  };

  const handleWakeWordRetry = () => {
    userGestureArmedRef.current = true;
    speechStartRef.current();
  };

  return (
    <div
      className="min-h-screen w-full px-4 pb-28 pt-6 text-zinc-100 md:px-8"
      style={{
        backgroundColor: "#0a0a0c",
        backgroundImage:
          "radial-gradient(circle at 20% 10%, rgba(0,255,255,0.08), transparent 35%), radial-gradient(circle at 80% 25%, rgba(255,255,255,0.06), transparent 30%), radial-gradient(circle at 50% 90%, rgba(0,255,255,0.06), transparent 35%)",
      }}
    >
      <motion.div
        className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:grid-cols-12"
        variants={panelStaggerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.section variants={panelIntroVariants} className={`${GLASS_PANEL} p-5 md:col-span-3`}>
          <h2 className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">
            <TextScramble text="MICROSOFT TO-DO" />
          </h2>
          <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "68vh" }}>
            {tasks.length === 0 ? (
              <p className="text-sm text-zinc-400">
                <TextScramble text="No tasks loaded." />
              </p>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={task.isDone ? "text-zinc-500 line-through" : "text-zinc-100"}>
                      <TextScramble text={task.title} />
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${task.isDone ? "bg-zinc-700 text-zinc-300" : "bg-cyan-400/20 text-cyan-200"
                        }`}
                    >
                      <TextScramble text={task.isDone ? "DONE" : "OPEN"} />
                    </span>
                  </div>
                  {task.dueDate ? (
                    <p className="mt-1 text-xs text-zinc-400">
                      <TextScramble text={`DUE ${task.dueDate}`} />
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </motion.section>

        <motion.section variants={panelIntroVariants} className={`${GLASS_PANEL} p-6 md:col-span-6`}>
          <h2 className="mb-4 text-center text-sm uppercase tracking-[0.22em] text-cyan-200/80">
            <TextScramble text="FOCUS CORE" />
          </h2>
          <div className="flex flex-col items-center justify-center">
            <div
              className="relative grid h-72 w-72 place-items-center rounded-full border border-cyan-300/35"
              style={{
                boxShadow:
                  "0 0 28px rgba(0,255,255,0.35), inset 0 0 42px rgba(0,255,255,0.18), 0 0 110px rgba(0,255,255,0.25)",
                background:
                  "radial-gradient(circle at 30% 20%, rgba(0,255,255,0.16), rgba(255,255,255,0.02) 45%, rgba(0,0,0,0.35) 100%)",
              }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full border-4 border-cyan-300/80"
                style={{
                  width: `${Math.max(0, Math.min(100, progressPct))}%`,
                  borderRight: "none",
                  borderTopLeftRadius: "999px",
                  borderBottomLeftRadius: "999px",
                  boxShadow: "0 0 20px rgba(0,255,255,0.55)",
                }}
              />
              <div className="relative z-10 text-center">
                <p className="font-mono text-6xl tracking-wider text-cyan-100">
                  <TextScramble text={formatTime(remainingSeconds)} />
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.28em] text-zinc-400">
                  <TextScramble text={isRunning ? "IN SESSION" : "PAUSED"} />
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsRunning((prev) => !prev)}
                className="rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-300/20"
              >
                <TextScramble text={isRunning ? "PAUSE" : "START"} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRunning(false);
                  setRemainingSeconds(durationMinutes * 60);
                }}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-white/10"
              >
                <TextScramble text="RESET" />
              </button>
            </div>
          </div>
        </motion.section>

        <motion.section variants={panelIntroVariants} className={`${GLASS_PANEL} p-5 md:col-span-3`}>
          <h2 className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">
            <TextScramble text="CIPHER INTELLIGENCE" />
          </h2>
          <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "68vh" }}>
            {feed.map((entry) => (
              <article
                key={entry.id}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100"
              >
                <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                  <TextScramble text={String(entry.role || "").toUpperCase()} />
                </p>
                <p className="leading-relaxed text-zinc-100">
                  <TextScramble text={entry.text} />
                </p>
              </article>
            ))}
          </div>
        </motion.section>
      </motion.div>

      <CommandBar
        command={command}
        onCommandChange={(event) => setCommand(event.target.value)}
        onSubmit={onCommandSubmit}
        isBusy={isBusy}
        mode={commandBarMode}
        wakeWordStatus={wakeWordStatus}
        wakeWordSupported={wakeWordSupported}
        inputRef={inputRef}
        canRunCommandBarScan={canRunCommandBarScan}
        runCommandBarScan={runCommandBarScan}
        onIntroComplete={handleCommandBarIntroComplete}
        onWakeWordRetry={handleWakeWordRetry}
      />
    </div>
  );
}
