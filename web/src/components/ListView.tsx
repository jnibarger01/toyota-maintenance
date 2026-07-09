/**
 * List tab: what the advisor reads off the counter — due-now checklist first,
 * then the next-milestone preview with distance and (if monthly miles were
 * entered) an estimated timeframe.
 */
import { fmtMiles, type DueResponse, type ItemRow } from "../api";

function Items({ items }: { items: ItemRow[] }) {
  if (items.length === 0) return <p style={{ color: "var(--slate)" }}>No scheduled items at this milestone.</p>;
  return (
    <ul className="item-list">
      {items.map((it) => (
        <li key={`${it.mileage}-${it.service_name}`}>
          <div style={{ flex: 1 }}>
            <span className="item-name">{it.service_name}</span>
            {it.description && it.description !== it.service_name && (
              <p className="item-desc">{it.description}</p>
            )}
          </div>
          {it.category && <span className="item-cat">{it.category}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ListView({ due }: { due: DueResponse }) {
  const next = due.next;
  return (
    <div>
      <div className="card due-card">
        <h3>
          Due now — {fmtMiles(due.due_now.milestone)} mi
          <span className="count-chip">{due.due_now.items.length} items</span>
        </h3>
        <Items items={due.due_now.items} />
      </div>

      <div className="card next-card">
        <h3>
          Next — {fmtMiles(next.milestone)} mi
          <span className="count-chip">{next.items.length} items</span>
        </h3>
        <p style={{ marginTop: 0, color: "var(--slate)" }}>
          {fmtMiles(next.miles_away)} miles away
          {next.est_months_away !== null && <> · est. {next.est_months_away} month{next.est_months_away === 1 ? "" : "s"}</>}
          {next.wraps_cycle && <> · schedule cycle restarts (grid max {fmtMiles(due.mileage.grid_max)} mi)</>}
        </p>
        <Items items={next.items} />
      </div>
    </div>
  );
}
