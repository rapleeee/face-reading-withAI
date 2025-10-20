import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Face Reading Vision",
  description:
    "Face Reading Vision membantu membaca ekspresi wajah dan memberikan manifesting karier masa depan secara instan.",
  keywords: [
    "face reading",
    "manifesting",
    "karier",
    "AI",
    "webcam analysis",
  ],
  icons: {
    icon: "/brand-icon.svg",
    apple: "/brand-icon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
