"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Couldn’t load this page</h1>
      <button className="primary-button" onClick={reset}>
        Retry
      </button>
    </main>
  );
}
