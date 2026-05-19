import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dota Scout",
  description: "Counter-draft intel dashboard. Static build from STRATZ.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
