import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Kenobi | Asset review",
  description:
    "Review sensitive assets, approve changes, and export a client-neutral copy.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
