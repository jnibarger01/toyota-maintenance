/**
 * Grid tab: OEM-style interval matrix, scoped to the five nearby milestones.
 * Rows = union of service items across those milestones; the due column is red,
 * the first upcoming column amber. Built entirely from the local lookup DB.
 */
import type { DueResponse, ScheduleDetail } from "../api";

interface Props {
  due: DueResponse;
  detail: ScheduleDetail;
}

export function GridView({ due, detail }: Props) {
  const milestones = due.nearby.map((n) => n.milestone);
  if (milestones.length === 0) {
    return <div className="notice">No milestones available for this schedule.</div>;
  }
  const snapped = due.mileage.snapped_milestone;
  const firstAhead = due.nearby.find((n) => n.relation === "ahead")?.milestone ?? null;
  const inWindow = new Set(milestones);

  // Union of items across the window; keep stable service order.
  const rows = new Map<string, { order: number; category: string | null; at: Set<number> }>();
  for (const it of detail.items) {
    if (!inWindow.has(it.mileage)) continue;
    const existing = rows.get(it.service_name);
    if (existing) {
      existing.at.add(it.mileage);
      existing.order = Math.min(existing.order, it.sort_order ?? 999);
    } else {
      rows.set(it.service_name, {
        order: it.sort_order ?? 999,
        category: it.category,
        at: new Set([it.mileage]),
      });
    }
  }
  const sorted = [...rows.entries()].sort(
    (a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])
  );

  const colClass = (m: number) =>
    m === snapped ? "col-due" : m === firstAhead ? "col-ahead-first" : "";

  return (
    <div className="grid-wrap">
      <table className="svc-grid">
        <thead>
          <tr>
            <th className="row-head" scope="col">Service item</th>
            {milestones.map((m) => {
              const rel = due.nearby.find((n) => n.milestone === m)?.relation;
              return (
                <th key={m} scope="col" className={colClass(m)}>
                  {(m / 1000).toLocaleString("en-US")}K
                  <span className="th-sub">
                    {rel === "due" ? "DUE NOW" : rel === "ahead" ? "AHEAD" : "BEHIND"}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(([name, row]) => (
            <tr key={name}>
              <th className="row-head" scope="row">
                {name}
                {row.category && <span className="item-cat" style={{ marginLeft: 8 }}>{row.category}</span>}
              </th>
              {milestones.map((m) => (
                <td key={m} className={`mark ${colClass(m)}`}>
                  {row.at.has(m) ? <span className="dot" aria-label="scheduled" /> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
