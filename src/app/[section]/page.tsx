import { notFound, redirect } from "next/navigation";
import { Telos } from "@/components/telos";
import { AuthPage } from "@/components/auth";
import { Welcome } from "@/components/welcome";
const sections = [
  "find",
  "search",
  "nearby",
  "matches",
  "saved",
  "connections",
  "messages",
  "notifications",
  "settings",
  "profile",
];
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { section } = await params;
  if (section === "search" || section === "discover") {
    const values = await searchParams;
    const query = (typeof values.q === "string" ? values.q : "").slice(0, 200);
    const tab = values.tab === "posts" ? "posts" : "people";
    if (section === "discover")
      redirect(
        `/search${query ? `?${new URLSearchParams({ q: query, tab })}` : ""}`,
      );
    return (
      <Telos section="search" initialQuery={query} initialSearchTab={tab} />
    );
  }
  if (section === "intents") redirect("/find");
  if (
    section === "login" ||
    section === "signup" ||
    section === "reset-password" ||
    section === "resend-confirmation" ||
    section === "update-password"
  )
    return <AuthPage key={section} mode={section} />;
  if (section === "welcome") return <Welcome />;
  if (section === "feed") return <Telos section="home" />;
  if (!sections.includes(section)) notFound();
  return <Telos section={section} />;
}
