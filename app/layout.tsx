import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RIA File Ops",
  description:
    "Document intelligence for RIA operations: clean up files, extract client data, and prep advisor workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
