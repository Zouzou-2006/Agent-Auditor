import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Auditor",
  description: "Internal controls for an AI agent that pays with USDC on Solana: rules before payment, on-chain matching, delivery checks and booking after.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
