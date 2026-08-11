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
    "세 장의 카드와 세 번의 타임루프로 도시의 다음 5분을 설계하는 재난 대응 시뮬레이션";
  const image = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "재난 5분 전 | 옵티마이저",
      template: "%s | 옵티마이저",
    },
    description,
    alternates: { canonical: "/" },
    icons: {
      icon: "/optimizer-mark.svg",
      shortcut: "/optimizer-mark.svg",
    },
    openGraph: {
      title: "재난 5분 전, 옵티마이저",
      description,
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "재난 5분 전 옵티마이저 — 도시 네트워크와 5분 카운트다운" }],
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
  themeColor: "#f5f5f7",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("optimizer-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
