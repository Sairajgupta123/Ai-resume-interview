import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify deletion request | MZOBS Privacy Center",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

export default function VerifyDeletionLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
