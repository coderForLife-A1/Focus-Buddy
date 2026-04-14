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
      },
      animation: {
        glowPulse: "glowPulse 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
