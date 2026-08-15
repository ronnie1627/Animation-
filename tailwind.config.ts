import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A10",
        panel: "#14141C",
        line: "#26262F",
        signal: "#8B5CF6",
        signal2: "#EC4899",
        signal3: "#22D3EE",
        mist: "#9A98A8"
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"]
      },
      backgroundImage: {
        aurora: "linear-gradient(135deg, #8B5CF6 0%, #EC4899 50%, #22D3EE 100%)"
      }
    }
  },
  plugins: []
};
export default config;
