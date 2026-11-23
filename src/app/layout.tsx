import type { Metadata } from "next";
import { Provider } from "@/components/provider";
import "./globals.css";
import "./pilot.css";
export const metadata: Metadata = {
  title: {
    default: "Telos — Connections with a purpose",
    template: "%s | Telos",
  },
  description:
    "Find people around what you want to learn, build, offer or do. Discover related intentions and turn common ground into a conversation.",
  openGraph: {
    title: "Telos — Start with a purpose",
    description: "A common place to connect around what you want to do next.",
    type: "website",
    siteName: "Telos",
  },
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
