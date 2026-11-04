"use client";
import Link from "next/link";
import { Logo } from "./ui";
export function Welcome() {
  return (
    <main className="welcome-screen">
      <Link href="/" aria-label="Telos">
        <Logo />
      </Link>
      <div className="welcome-wordmark">
        telos<span>.</span>
      </div>
      <div className="welcome-buttons">
        <Link href="/signup" className="primary-button">
          Create account
        </Link>
        <Link href="/login" className="secondary-button">
          Sign in
        </Link>
      </div>
    </main>
  );
}
