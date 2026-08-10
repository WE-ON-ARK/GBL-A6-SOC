import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || (host.startsWith("localhost") ? "http" : "https");
  let origin = "http://localhost:3000";
  try {
    origin = new URL(`${protocol}://${host}`).origin;
  } catch {
    // Keep the local fallback when proxy headers are malformed.
  }
  const description =
    "병목, 확률, 파레토 지표로 최선의 도시 대피 전략을 설계하는 AI 타임루프 챌린지";
  const image = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "재난 5분 전 | 옵티마이저",
      template: "%s | 옵티마이저",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "재난 5분 전, 옵티마이저",
      description,
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "재난 5분 전, 옵티마이저" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "재난 5분 전, 옵티마이저",
      description,
      images: [image],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#07100f",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
