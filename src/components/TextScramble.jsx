import { useEffect, useMemo, useState } from "react";
import { hasPlayedScramble, markScramblePlayed } from "../lib/scramble";

const SCRAMBLE_CHARS = "!@#$%*&";

function randomChar() {
    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

function buildScrambleFrame(target, revealCount) {
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

export default function TextScramble({
    text,
    duration = 1800,
    className = "",
    as: Component = "span",
}) {
    const targetText = useMemo(() => String(text || ""), [text]);
    const [displayText, setDisplayText] = useState(targetText);

    useEffect(() => {
        let shouldScramble = true;

        shouldScramble = !hasPlayedScramble();

        if (!shouldScramble) {
            setDisplayText(targetText);
            return undefined;
        }

        const startedAt = performance.now();
        const interval = window.setInterval(() => {
            const elapsed = performance.now() - startedAt;
            const progress = Math.min(1, elapsed / Math.max(1, duration));
            const revealCount = Math.floor(progress * targetText.length);
            setDisplayText(buildScrambleFrame(targetText, revealCount));

            if (progress >= 1) {
                window.clearInterval(interval);
                setDisplayText(targetText);
                markScramblePlayed();
            }
        }, 34);

        return () => window.clearInterval(interval);
    }, [duration, targetText]);

    return (
        <Component
            className={className}
            style={{
                fontFamily: '"JetBrains Mono", "Fira Code", "SFMono-Regular", Menlo, Consolas, monospace',
            }}
        >
            {displayText}
        </Component>
    );
}
