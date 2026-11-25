import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://toki-rewards-kasai.hisa-0128-1996.chatgpt.site"), title: "TOKI｜ひらく、たまる。", applicationName: "TOKI",
  description: "なにげない時間に、ちいさな楽しみを。PC・スマホ・タブレット対応のポイント体験アプリ。現在は換金不可の体験版です。",
  robots: { index: false, follow: false }, manifest: "/manifest.webmanifest", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icon-180.png" },
  openGraph: { title: "TOKI｜ひらく、たまる。", description: "なにげない時間に、ちいさな楽しみを。体験版・換金不可。", type: "website", locale: "ja_JP", images: [{ url: "/og.png", width: 1200, height: 630, alt: "TOKI ひらく、たまる。" }] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#153f3c" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
