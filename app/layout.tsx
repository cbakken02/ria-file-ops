import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RIA File Ops",
  description: "Starter product for organizing client document intake for advisory firms.",
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
