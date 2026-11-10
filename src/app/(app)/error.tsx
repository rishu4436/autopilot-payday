"use client";

export default function ErrorScreen({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel stack">
      <h1>This screen could not load</h1>
      <p>{error.message || "The data for this page failed. Balances were not changed."}</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </section>
  );
}
