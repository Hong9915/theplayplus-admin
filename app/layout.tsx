import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "THE PLAY+ Admin",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#0a0a0a] text-white antialiased">{children}</body>
    </html>
  );
}
