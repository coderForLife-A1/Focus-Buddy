export const SCRAMBLE_FLAG_KEY = "cipher-text-scramble-played-v1";

export function hasPlayedScramble() {
    try {
        return window.localStorage.getItem(SCRAMBLE_FLAG_KEY) === "1";
    } catch (_error) {
        return false;
    }
}

export function markScramblePlayed() {
    try {
        window.localStorage.setItem(SCRAMBLE_FLAG_KEY, "1");
    } catch (_error) {
        // Ignore storage write failures.
    }
}

export function resetScramblePlayed() {
    try {
        window.localStorage.removeItem(SCRAMBLE_FLAG_KEY);
    } catch (_error) {
        // Ignore storage write failures.
    }
}
