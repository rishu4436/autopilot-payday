export default function Loading() {
  return (
    <div className="stack" aria-busy="true">
      <div className="grid-metrics">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="metric" style={{ minHeight: 110 }} />)}
      </div>
      <div className="panel" style={{ minHeight: 220 }} />
    </div>
  );
}
