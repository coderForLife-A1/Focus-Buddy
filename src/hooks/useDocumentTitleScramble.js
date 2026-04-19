import { useEffect, useMemo, useRef } from "react";

const SCRAMBLE_CHARS = "!@#$%*&";

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

        const startedAt = performance.now();
        const interval = window.setInterval(() => {
            const elapsed = performance.now() - startedAt;
            const progress = Math.min(1, elapsed / Math.max(1, duration));
            const revealCount = Math.floor(progress * finalTitle.length);
            document.title = buildFrame(finalTitle, revealCount);

            if (progress >= 1) {
                window.clearInterval(interval);
                document.title = finalTitle;
            }
        }, 34);

        return () => {
            window.clearInterval(interval);
            document.title = previousTitleRef.current || finalTitle;
        };
    }, [duration, finalTitle]);
}
