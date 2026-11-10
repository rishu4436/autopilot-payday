import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        elev: "var(--bg-elev)",
        elev2: "var(--bg-elev-2)",
        line: "var(--line)",
        ink: "var(--text)",
        mute: "var(--muted)",
        cyan: "var(--cyan)",
        mint: "var(--mint)",
        amber: "var(--amber)",
        coral: "var(--coral)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "var(--shadow)",
      },
    },
  },
  plugins: [],
};

export default config;
