import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "DocGenix — AI-Powered Software Docs",
  description: "Generate complete software documentation with AI agents",
  icons: { icon: "/icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body suppressHydrationWarning className="h-full">
        {children}
        <div id="small-screen-guard" aria-hidden="true">
          <p>This app is best viewed and used on desktop.</p>
        </div>
        <style>{`
          #small-screen-guard {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: #070d1a;
            color: #f1f5f9;
            font-family: var(--font-inter), system-ui, sans-serif;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 2rem;
            font-size: 1.1rem;
            line-height: 1.6;
          }
        `}</style>
      </body>
    </html>
  );
}
