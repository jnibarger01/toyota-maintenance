import { Link } from "react-router-dom";
import { modelSlug } from "../data/schema";

/** One card per distinct model; configurations are selected on the next route. */
export function ModelGrid({ year, models }: {
  year: number;
  models: string[];
}) {
  const distinctModels = [...new Set(models)];
  return (
    <section aria-labelledby="model-heading">
      <div className="section-header-row">
        <h2 id="model-heading" className="section-header">Select model · {year}</h2>
        <Link className="btn btn-link" to="/cockpit">Change year</Link>
      </div>
      <div className="tile-grid tile-grid-models">
        {distinctModels.map((m) => (
          <Link key={m} className="tile tile-model" to={`/vehicle/${year}/${modelSlug(m)}`}>
            <span>{m}</span>
            <span className="tile-meta">Choose configuration</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
