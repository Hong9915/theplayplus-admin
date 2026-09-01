import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "#F4F4F6",
        panel: "#FFFFFF",
        ink: "#1A1B1F",
        muted: "#6E7076",
        line: "#E5E6EA",
        accent: "#EA581F",
      },
    },
  },
  plugins: [],
};

export default config;
