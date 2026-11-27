import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MZOBS | AI Interview Studio",
  description: "Resume-aware AI interviews and evidence-based hiring reports.",
  // Invitation links carry a one-time bearer token in the query string.
  // Never forward that URL in Referer headers to assets or subsequent pages.
  referrer: "no-referrer"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}