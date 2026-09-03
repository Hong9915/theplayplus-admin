import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // 다른 세션이 만드는 .claude/worktrees 안의 테스트까지 돌리지 않는다.
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
});
