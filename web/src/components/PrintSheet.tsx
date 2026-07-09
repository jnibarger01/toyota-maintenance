import type { LookupResult } from "../api";
import { dollars } from "../api";

/**
 * Print-friendly customer sheet. Rendered off-screen; @media print shows ONLY this.
 *
 * Hard content rules (tested):
 *  - no raw JSON, no op codes, no labor hours, no internal notes
 *  - no full config key / schedule hash — a short schedule reference only
 *  - prices appear only when the dealership menu maps them explicitly
 *  - black-and-white friendly, one page where the schedule allows
 */
export function PrintSheet({ result }: { result: LookupResult }) {
  const v = result.vehicle;
  const m = result.mileage;
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
  const shortRef = `${result.source.config_key.slice(0, 10)} / ${result.source.schedule_hash.slice(0, 10)}`;

  return (
    <section className="print-root" aria-hidden="true">
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
        <h2>{m.current_interval !== null ? `Due at ${fmt(m.current_interval)} miles` : "Scheduled maintenance"}</h2>
        {m.current_interval !== null && result.due_now.length > 0 ? (
          <ul className="print-checklist">
            {result.due_now.map((t) => (
              <li key={t.task_key} className="print-row">
                <span className="print-box" aria-hidden="true" />
                <span className="print-task">
                  {t.advisor_label ?? t.task_name}
                  {t.advisor_label ? ` (${t.task_name})` : ""}
                </span>
                {t.menu_price_cents !== null ? <span className="print-price">{dollars(t.menu_price_cents)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No factory interval reached yet — first scheduled service at {fmt(m.next_interval)} miles.</p>
        )}
        {result.overdue.length > 0 ? (
          <p className="print-verify">
            Verify against service history ({fmt(m.previous_interval)}-mile items):{" "}
            {result.overdue.map((t) => t.task_name).join("; ")}.
          </p>
        ) : null}
      </section>

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
        Source: {result.source.source} factory maintenance schedule · Schedule ref {shortRef} · No pricing implied unless shown.
      </footer>
    </section>
  );
}
