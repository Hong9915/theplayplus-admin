import type { MetadataRoute } from "next";

/**
 * 휴대폰 "홈 화면에 추가"용 웹 앱 설정. 앱 아이콘으로 열면 주소창 없이 문의함이 꽉 찬 화면으로 뜬다.
 * 시작 화면은 /이고, 거기서 로그인·첫 게임 문의함으로 넘어간다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "THE PLAY+ Admin",
    short_name: "PLAY+ 관리자",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#E9ECF1",
    theme_color: "#E9ECF1",
    lang: "ko",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
