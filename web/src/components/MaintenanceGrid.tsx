import { Fragment } from "react";
import type { GridResponse } from "../api";
import { EmptyState } from "./States";

/** Grid tab — service items \u00d7 mileage intervals, category-grouped. */
export function MaintenanceGrid({ grid }: { grid: GridResponse }) {
  if (grid.columns.length === 0) {
    return <EmptyState title="No published intervals for this schedule" hint="Some configurations (e.g. new EVs) have no factory interval grid." />;
  }
  let lastCategory: string | null = null;
  return (
    <div className="grid-scroll">
      <table className="mx-grid">
        <thead>
          <tr>
            <th scope="col" className="mx-grid-service">Service</th>
            {grid.columns.map((c) => (
              <th key={c.mileage} scope="col" className={c.current ? "mx-col current" : "mx-col"}>
                {c.label}
                {c.current ? <span className="current-tag">current</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => {
            const header = r.category !== lastCategory
              ? (
                <tr key={`cat-${r.category}`} className="mx-cat-row">
                  <th scope="rowgroup" colSpan={grid.columns.length + 1}>{r.category}</th>
                </tr>
              )
              : null;
            lastCategory = r.category;
            return (
              <Fragment key={r.taskName}>
                {header}
                <tr>
                  <th scope="row" className="mx-grid-service">
                    {r.taskName}
                    {r.advisor_label ? <span className="advisor-label">{r.advisor_label}</span> : null}
                  </th>
                  {grid.columns.map((c) => (
                    <td key={c.mileage} className={c.current ? "mx-cell current" : "mx-cell"}>
                      {r.cells[String(c.mileage)] ? <span aria-label="scheduled">✓</span> : ""}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
