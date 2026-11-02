import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "THE PLAY+ Admin",
  // iPhone "홈 화면에 추가"로 열면 주소창 없이 앱처럼 뜬다. 안드로이드는 app/manifest.ts를 쓴다.
  appleWebApp: { capable: true, title: "PLAY+ 관리자", statusBarStyle: "default" as const },
};

export const viewport = {
  themeColor: "#E9ECF1",
  width: "device-width",
  initialScale: 1,
  // 노치·홈 막대 영역까지 그리고, 안쪽 여백은 env(safe-area-inset-*)로 준다.
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body className="min-h-screen bg-ground font-sans text-ink antialiased">
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
