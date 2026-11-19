import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MZOBS | AI Interview Studio",
  description: "Resume-aware AI interviews and evidence-based hiring reports."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}