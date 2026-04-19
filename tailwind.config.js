/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 16px rgba(0,255,255,0.24)" },
          "50%": { boxShadow: "0 0 28px rgba(0,255,255,0.45)" },
        },
        neuralPulse: {
          "0%, 100%": {
            boxShadow: "0 0 26px 0 rgba(0,255,255,0.27)",
            borderColor: "rgba(0,255,255,0.27)",
          },
          "50%": {
            boxShadow: "0 0 34px 2px rgba(0,255,255,0.67)",
            borderColor: "rgba(0,255,255,0.67)",
          },
        },
        neuralBadge: {
          "0%, 100%": { opacity: "0.75" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        glowPulse: "glowPulse 2.2s ease-in-out infinite",
        "neural-pulse-slow": "neuralPulse 2s ease-in-out infinite",
        "neural-pulse-fast": "neuralPulse 0.8s ease-in-out infinite",
        "neural-badge-slow": "neuralBadge 2s ease-in-out infinite",
        "neural-badge-fast": "neuralBadge 0.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
