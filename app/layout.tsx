import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invoice Agent · Acme Retail AP",
  description: "Invoice PDF in → reasoned payment decision out",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
