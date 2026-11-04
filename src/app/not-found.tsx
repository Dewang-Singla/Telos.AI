import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>Page not found</h1>
      <Link href="/" className="primary-button">
        Home
      </Link>
    </main>
  );
}
