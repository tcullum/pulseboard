import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  return {
    title: "Pulseboard — Mac System Monitor",
    description: "A polished, real-time overview of your Mac's performance, health, storage, battery, and processes.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Pulseboard — Your Mac, at a glance", description: "Performance, health, storage, battery, and processes in one calm command center.", images: [`${origin}/og.png`] },
    twitter: { card: "summary_large_image", title: "Pulseboard — Your Mac, at a glance", description: "A professional system monitor for macOS.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
