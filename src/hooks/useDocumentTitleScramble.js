import { useEffect, useMemo, useRef } from "react";

const SCRAMBLE_CHARS = "!@#$%*&";
const SCRAMBLE_SESSION_KEY = "cipher-text-scramble-played-v1";

function randomChar() {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function buildFrame(target, revealCount) {
    return target
        .split("")
        .map((char, index) => {
            if (char === " ") {
                return " ";
            }
            return index < revealCount ? char : randomChar();
        })
        .join("");
}

export default function useDocumentTitleScramble(title, duration = 1800) {
    const finalTitle = useMemo(() => String(title || ""), [title]);
    const previousTitleRef = useRef("");

    useEffect(() => {
        previousTitleRef.current = document.title;

        let shouldScramble = true;

        try {
            shouldScramble = window.localStorage.getItem(SCRAMBLE_SESSION_KEY) !== "1";
        } catch (_error) {
            shouldScramble = true;
        }

        if (!shouldScramble) {
            document.title = finalTitle;
            return undefined;
        }

        const startedAt = performance.now();
        const interval = window.setInterval(() => {
            const elapsed = performance.now() - startedAt;
            const progress = Math.min(1, elapsed / Math.max(1, duration));
            const revealCount = Math.floor(progress * finalTitle.length);
            document.title = buildFrame(finalTitle, revealCount);

            if (progress >= 1) {
                window.clearInterval(interval);
                document.title = finalTitle;
                try {
                    window.localStorage.setItem(SCRAMBLE_SESSION_KEY, "1");
                } catch (_error) {
                    // Ignore storage write failures.
                }
            }
        }, 34);

        return () => {
            window.clearInterval(interval);
            document.title = previousTitleRef.current || finalTitle;
        };
    }, [duration, finalTitle]);
}
