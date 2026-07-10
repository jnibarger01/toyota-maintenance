import { Link } from "react-router-dom";

/** Pick an imported model year. Each tile is a real, deep-linkable route. */
export function YearSelector({ years }: { years: number[] }) {
  return (
    <section aria-labelledby="year-heading">
      <h2 id="year-heading" className="section-header">Select model year</h2>
      <div className="tile-grid tile-grid-years">
        {years.map((y) => (
          <Link key={y} className="tile" to={`/cockpit/${y}`}>
            {y}
          </Link>
        ))}
      </div>
    </section>
  );
}
