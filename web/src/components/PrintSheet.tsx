import type { GridResponse, LookupResult } from "../api";

/**
 * Print-friendly customer sheet. Rendered off-screen; @media print shows ONLY this.
 *
 * Hard content rules (tested):
 *  - no raw JSON, no op codes, no labor hours, no internal notes
 *  - no full config key / schedule hash — a short schedule reference only
 *  - no pricing — customer handouts point to the dealership service menu
 *  - black-and-white friendly, one page where the schedule allows
 */
export function PrintSheet({ result, grid, includedTaskNames, preview = false }: {
  result: LookupResult;
  grid?: GridResponse;
  includedTaskNames?: string[];
  preview?: boolean;
}) {
  const v = result.vehicle;
  const m = result.mileage;
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
  const shortRef = `${result.source.config_key.slice(0, 10)} / ${result.source.schedule_hash.slice(0, 10)}`;
  const visibleDue = result.due_now.filter((t) => t.customer_visible !== 0);
  const visibleOverdue = result.overdue.filter((t) => t.customer_visible !== 0);
  const defaultNames = [...new Set([...visibleDue, ...visibleOverdue].map((task) => task.task_name))];
  const selected = new Set(includedTaskNames ?? defaultNames);
  const dueNow = visibleDue.filter((task) => selected.has(task.task_name));
  const overdue = visibleOverdue.filter((task) => selected.has(task.task_name));
  const resultTaskNames = new Set([...visibleDue, ...visibleOverdue].map((task) => task.task_name));
  const additionalRows = (grid?.rows ?? []).filter((row) =>
    row.customer_visible !== 0 && selected.has(row.taskName) && !resultTaskNames.has(row.taskName));

  return (
    <section className={preview ? "print-root print-root-preview" : "print-root"} aria-hidden={!preview}>
      <header className="print-header avoid-break">
        {/* Black Hendrick Automotive Group mark per brand rule for monochrome printing. */}
        <div className="print-brandline">
          <img className="print-logo" src="/brand/hag-black.png" alt="Hendrick Automotive Group™" />
          <span className="print-store">Hendrick Toyota Merriam</span>
        </div>
        <h1>Service Department · Maintenance Review</h1>
        <p className="print-advisor-line">Advisor: ____________________&nbsp;&nbsp;&nbsp;Date: ______________</p>
      </header>

      <section className="print-vehicle avoid-break">
        <h2>Vehicle</h2>
        <p>
          {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""} · {v.engine ?? "—"} · {v.drivetrain ?? "—"} · {v.transmission ?? "—"}
        </p>
        <p>
          Odometer: <strong>{fmt(m.current)} miles</strong>
          &nbsp;·&nbsp; Driving condition: <strong>{v.driving_condition}</strong>
        </p>
      </section>

      <section className="print-group avoid-break">
        <h2>{m.current_interval !== null ? `Scheduled at ${fmt(m.current_interval)} miles` : "Scheduled maintenance"}</h2>
        {result.intervals.length === 0 ? (
          <p>No published maintenance intervals were included in this schedule.</p>
        ) : m.current_interval !== null && dueNow.length > 0 ? (
          <ul className="print-checklist">
            {dueNow.map((t) => (
              <li key={t.task_key} className="print-row">
                <span className="print-box" aria-hidden="true" />
                <span className="print-task">
                  {t.task_name}
                  {t.advisor_label ? ` (${t.advisor_label})` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : m.current_interval === null ? (
          <p>No factory interval reached yet — first scheduled service at {fmt(m.next_interval)} miles.</p>
        ) : (
          <p>No current-interval items are selected for this printout.</p>
        )}
        {overdue.length > 0 ? (
          <p className="print-verify">
            Verify against service history ({fmt(m.previous_interval)}-mile items):{" "}
            {overdue.map((t) => t.task_name).join("; ")}.
          </p>
        ) : null}
      </section>

      {additionalRows.length > 0 ? (
        <section className="print-group avoid-break">
          <h2>Additional selected schedule items</h2>
          <ul className="print-checklist">
            {additionalRows.map((row) => {
              const intervals = [...new Set(row.details
                .filter((detail) => detail.customer_visible !== 0)
                .map((detail) => detail.mileage))]
                .sort((a, b) => a - b)
                .map((value) => `${fmt(value)} mi`)
                .join(", ");
              return (
                <li key={row.taskName} className="print-row">
                  <span className="print-box" aria-hidden="true" />
                  <span className="print-task">
                    {row.taskName}{row.advisor_label ? ` (${row.advisor_label})` : ""}
                    {intervals ? <span className="print-intervals"> · {intervals}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="print-group avoid-break">
        <h2>Next service milestone</h2>
        <p>
          {m.next_interval !== null
            ? `${fmt(m.next_interval)} miles` +
              (result.estimate.months_to_next !== null
                ? ` — about ${result.estimate.months_to_next} month${result.estimate.months_to_next === 1 ? "" : "s"} at your current pace` +
                  (result.estimate.next_due_date ? ` (around ${result.estimate.next_due_date})` : "")
                : "")
            : "Past the last published interval — your advisor will schedule from service history."}
        </p>
      </section>

      <section className="print-group avoid-break print-notes">
        <h2>Advisor notes</h2>
        <div className="print-note-line" />
        <div className="print-note-line" />
        <div className="print-note-line" />
      </section>

      <footer className="print-footer">
        Source: {result.source.source} factory maintenance schedule · Schedule ref {shortRef} · No pricing shown; see the dealership service menu.
      </footer>
    </section>
  );
}
