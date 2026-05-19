import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0c10",
          800: "#101319",
          700: "#1a1f29",
          600: "#252b38",
          500: "#3a4150",
          400: "#5a6373",
          300: "#8892a0",
          200: "#c2c7d0",
          100: "#e5e7eb",
        },
        accent: {
          good: "#3ec47a",
          mid: "#f5b945",
          bad: "#e25c5c",
          flex: "#a679f0",
          gem: "#c084fc",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
