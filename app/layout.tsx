import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Developer Agent Workbench",
  description: "LangGraph + Gemini + Next.js developer agent with HITL approvals",
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
