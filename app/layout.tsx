import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "THE PLAY+ Admin",
};

export const viewport = {
  themeColor: "#F4F4F6",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-ground text-ink antialiased">
        {/* 키보드 사용자가 게임 레일·보기·목록을 매번 지나치지 않도록 본문으로 바로 가는 링크. 초점을 받을 때만 보인다. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-lg focus:ring-2 focus:ring-accent"
        >
          본문으로 건너뛰기
        </a>
        {children}
      </body>
    </html>
  );
}
