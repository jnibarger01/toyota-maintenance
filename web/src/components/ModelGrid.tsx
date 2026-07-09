/** Step 2 — pick the model. */
export function ModelGrid({ year, models, onSelect, onBack }: {
  year: number;
  models: string[];
  onSelect: (model: string) => void;
  onBack: () => void;
}) {
  return (
    <section aria-labelledby="model-heading">
      <div className="section-header-row">
        <h2 id="model-heading" className="section-header">Select model · {year}</h2>
        <button type="button" className="btn btn-link" onClick={onBack}>Change year</button>
      </div>
      <div className="tile-grid tile-grid-models">
        {models.map((m) => (
          <button key={m} type="button" className="tile tile-model" onClick={() => onSelect(m)}>
            {m}
          </button>
        ))}
      </div>
    </section>
  );
}
