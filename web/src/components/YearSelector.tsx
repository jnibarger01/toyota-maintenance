/** Step 1 — pick a model year from a large keyboard-friendly grid. */
export function YearSelector({ years, onSelect }: { years: number[]; onSelect: (year: number) => void }) {
  return (
    <section aria-labelledby="year-heading">
      <h2 id="year-heading" className="section-header">Select model year</h2>
      <div className="tile-grid tile-grid-years">
        {years.map((y) => (
          <button key={y} type="button" className="tile" onClick={() => onSelect(y)}>
            {y}
          </button>
        ))}
      </div>
    </section>
  );
}
