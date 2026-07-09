/**
 * Customer sheet. Rendered twice: once inside the Print tab as an on-screen
 * preview, and once hidden at the document root (.print-root) which is the
 * only element visible under @media print.
 *
 * Constraint honored: no pricing anywhere — the sheet says so explicitly and
 * points to the dealership service menu.
 */
import { fmtMiles, shortHash, type DueResponse } from "../api";

export function PrintSheet({ due }: { due: DueResponse }) {
  const v = due.vehicle;
  const m = due.mileage;
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const p = due.provenance;

  return (
    <div className="print-sheet">
      <div className="ps-header">
        <div className="ps-dealer">Hendrick Toyota Merriam — Service</div>
        <div className="ps-doc">
          Factory maintenance recommendation
          <br />
          Prepared {today}
        </div>
      </div>

      <div className="ps-vehicle">
        <div>
          <div className="ps-vname">
            {v.year} {v.make} {v.model} {v.trim}
          </div>
          <div className="ps-vmeta" style={{ textAlign: "left" }}>
            {v.engine} · {v.drivetrain} · {v.transmission} · {v.driving_condition} driving schedule
          </div>
        </div>
        <div className="ps-vmeta">
          Odometer: {fmtMiles(m.entered)} mi
          <br />
          Service interval: {fmtMiles(m.snapped_milestone)} mi
        </div>
      </div>

      {m.extrapolated && (
        <p style={{ fontSize: 11 }}>
          <strong>Note:</strong> this odometer reading is beyond the last published milestone
          ({fmtMiles(m.grid_max)} mi); recommendations repeat the factory cycle at the{" "}
          {fmtMiles(m.cycle_mileage)}-mile point. Your advisor will confirm against service history.
        </p>
      )}

      <div className="ps-section-title">
        Recommended at {fmtMiles(due.due_now.milestone)} miles — {due.due_now.items.length} items
      </div>
      <ul className="ps-check">
        {due.due_now.items.map((it) => (
          <li key={it.service_name}>
            <span className="box" aria-hidden="true" />
            <span>{it.service_name}</span>
            {it.category && <span className="cat">{it.category}</span>}
          </li>
        ))}
        {due.due_now.items.length === 0 && <li>No factory items at this exact milestone.</li>}
      </ul>

      <div className="ps-next">
        <strong>Your next visit:</strong> {fmtMiles(due.next.milestone)}-mile service,{" "}
        {fmtMiles(due.next.miles_away)} miles from today
        {due.next.est_months_away !== null &&
          ` (about ${due.next.est_months_away} month${due.next.est_months_away === 1 ? "" : "s"} at your driving pace)`}
        . {due.next.items.length} scheduled items.
      </div>

      <div className="ps-foot">
        Source: {p.source} factory maintenance schedule · schedule {shortHash(p.schedule_key)} ·
        content hash {shortHash(p.schedule_hash)} · schedule updated {p.last_updated ?? "—"} ·
        lookup database built {p.db_built_at ?? "—"}
        <br />
        Pricing is not shown on this sheet — please see the dealership service menu or your advisor
        for current pricing. This sheet reflects the factory {v.driving_condition.toLowerCase()}
        -condition schedule for the vehicle configuration listed above and is not a repair order.
      </div>
    </div>
  );
}
