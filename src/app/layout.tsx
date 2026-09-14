import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Silpo Party",
  description: "Silpo-connected party planning",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
