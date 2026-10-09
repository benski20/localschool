/** Design tokens live in src/styles/tokens.css; Tailwind only maps names to them. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        panel: token("panel"),
        subtle: token("subtle"),
        line: token("border"),
        "line-strong": token("border-strong"),
        ink: token("text"),
        muted: token("muted"),
        faint: token("faint"),
        accent: token("accent"),
        "accent-fg": token("accent-fg"),
        "accent-soft": token("accent-soft"),
        danger: token("danger"),
        warning: token("warning"),
        success: token("success"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["16px", { lineHeight: "26px" }],
        lg: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
        xl: ["28px", { lineHeight: "34px", letterSpacing: "-0.02em" }],
      },
      borderRadius: { sm: "4px", DEFAULT: "6px", md: "6px", lg: "8px", xl: "12px" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 1px rgb(var(--border))",
        pop: "0 12px 32px -8px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--border))",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        fadein: { from: { opacity: 0, transform: "translateY(2px)" }, to: { opacity: 1, transform: "none" } },
        blink: { "50%": { opacity: 0 } },
        indeterminate: { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(300%)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        fadein: "fadein 160ms ease-out both",
        blink: "blink 1s steps(1) infinite",
        indeterminate: "indeterminate 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
