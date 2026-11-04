import type { Metadata } from "next";
import { Provider } from "@/components/provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "Telos",
  description: "Telos",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
