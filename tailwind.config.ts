import type { Config } from "tailwindcss";

/**
 * "관제석" 팔레트. 테두리보다 면의 명도로 위계를 만든다:
 * ground(바깥 작업면) < well(목록·상세 패널) < panel(대화 종이).
 * accent는 "새로 들어온 일"과 주요 동작에만, heat는 미처리 경과 시간에만 쓴다.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "#E9ECF1",
        well: "#F2F4F7",
        panel: "#FFFFFF",
        thread: "#F6F7F9",
        // 게임 레일은 브랜드 주황. 레일 위의 배지·현재 위치 표시는 주황이 아닌 색을 쓴다.
        rail: "#EA581F",
        ink: "#18202E",
        "ink-2": "#465063",
        // 시안의 #7A8496은 흰 바탕에서 4.5:1에 못 미친다. 작은 글자도 읽히게 한 단계 진하게.
        muted: "#667085",
        line: "#DCE0E7",
        "line-soft": "#E8EBF0",
        accent: { DEFAULT: "#EA581F", ink: "#B83E0E", wash: "#FDEDE5" },
        heat: { fresh: "#2E9A8C", warm: "#C08A0E", hot: "#D7443E", stale: "#8A2A63" },
        memo: { DEFAULT: "#FFF3D1", line: "#E9C766", ink: "#6B4E00" },
        ai: { DEFAULT: "#6B4FD8", wash: "#EEEAFD" },
        done: { DEFAULT: "#4F6B5C", wash: "#E6EFEA" },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', "Pretendard", "-apple-system", "system-ui", "sans-serif"],
      },
      boxShadow: {
        paper: "0 1px 0 rgba(24,32,46,.04), 0 8px 24px -12px rgba(24,32,46,.18)",
        lift: "0 30px 80px -20px rgba(0,0,0,.45)",
      },
      // 서랍은 오른쪽에서 들어와 같은 길로 나간다. 나가는 곡선은 들어오는 곡선을 뒤집은 것.
      keyframes: {
        "drawer-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "drawer-out": { from: { transform: "translateX(0)" }, to: { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
      },
      animation: {
        "drawer-in": "drawer-in 260ms cubic-bezier(.2,.8,.2,1)",
        "drawer-out": "drawer-out 200ms cubic-bezier(.8,0,.8,.2) forwards",
        "fade-in": "fade-in 260ms ease-out",
        "fade-out": "fade-out 200ms ease-in forwards",
      },
    },
  },
  plugins: [],
};

export default config;
