import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fourier Studio — Draw with mathematics",
  description: "Turn images into Fourier series and watch rotating epicycles reconstruct the curve. Free, private, browser-based image tracing.",
  applicationName: "Fourier Studio",
  keywords: ["Fourier series", "epicycles", "Fourier transform", "curve tracing", "mathematics", "image to curve"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080a0d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
