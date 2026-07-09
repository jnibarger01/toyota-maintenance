/**
 * Guide tab: the advisor's walk-through, in the order it plays at the counter.
 * The steps are a real sequence — position, due work, condition check, booking.
 */
import { fmtMiles, type DueResponse } from "../api";

function projectedMonth(monthsAway: number | null): string | null {
  if (monthsAway === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() + monthsAway);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function GuideView({ due }: { due: DueResponse }) {
  const m = due.mileage;
  const cc = due.condition_comparison;
  const proj = projectedMonth(due.next.est_months_away);

  // Group due items by category for the talk-track.
  const byCat = new Map<string, string[]>();
  for (const it of due.due_now.items) {
    const cat = it.category ?? "General";
    const arr = byCat.get(cat) ?? [];
    arr.push(it.service_name);
    byCat.set(cat, arr);
  }

  return (
    <div className="card">
      <div className="guide-step">
        <div className="step-mark">1</div>
        <div>
          <h4>Where this vehicle sits</h4>
          <p>
            Odometer reads <strong>{fmtMiles(m.entered)}</strong>. The factory schedule runs a{" "}
            {fmtMiles(m.step)}-mile grid from {fmtMiles(m.grid_min)} to {fmtMiles(m.grid_max)}, so this
            visit maps to the <strong>{fmtMiles(m.snapped_milestone)}-mile service</strong> (nearest
            interval; ties round up to the later service).
          </p>
          {m.extrapolated && (
            <p>
              <span className="badge warn">Beyond published grid</span>{" "}
              The odometer is past the last published milestone, so the schedule repeats its cycle —
              this reading lands at the {fmtMiles(m.cycle_mileage)}-mile point of the cycle. Confirm
              against vehicle history before presenting.
            </p>
          )}
          <p className="talk">
            “Based on your mileage, you're right at the {fmtMiles(m.snapped_milestone)}-mile factory
            service.”
          </p>
        </div>
      </div>

      <div className="guide-step">
        <div className="step-mark">2</div>
        <div>
          <h4>What Toyota calls for today — {due.due_now.items.length} items</h4>
          {[...byCat.entries()].map(([cat, names]) => (
            <p key={cat}>
              <strong>{cat}:</strong> {names.join("; ")}.
            </p>
          ))}
          {due.due_now.items.length === 0 && <p>No items are scheduled at this exact milestone.</p>}
        </div>
      </div>

      {cc && (
        <div className="guide-step">
          <div className="step-mark">3</div>
          <div>
            <h4>Driving-condition check — {due.vehicle.driving_condition} vs {cc.other_condition}</h4>
            <p>
              This lookup uses the <strong>{due.vehicle.driving_condition}</strong> schedule. The{" "}
              {cc.other_condition} schedule lists <strong>{cc.other_item_count}</strong> items at this
              milestone. Towing, short trips, dirt roads, or extensive idling qualify as Severe — ask
              before you present.
            </p>
            <div className="delta-cols">
              <div>
                <strong>Only on {cc.other_condition}</strong>
                {cc.items_only_in_other.length ? (
                  <ul>{cc.items_only_in_other.map((s) => <li key={s}>{s}</li>)}</ul>
                ) : (
                  <p style={{ color: "var(--slate)" }}>No additional items.</p>
                )}
              </div>
              <div>
                <strong>Only on {due.vehicle.driving_condition}</strong>
                {cc.items_only_in_current.length ? (
                  <ul>{cc.items_only_in_current.map((s) => <li key={s}>{s}</li>)}</ul>
                ) : (
                  <p style={{ color: "var(--slate)" }}>No additional items.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="guide-step">
        <div className="step-mark">{cc ? 4 : 3}</div>
        <div>
          <h4>Set the next visit</h4>
          <p>
            Next milestone is <strong>{fmtMiles(due.next.milestone)} mi</strong> —{" "}
            {fmtMiles(due.next.miles_away)} miles from today's reading
            {due.next.est_months_away !== null && (
              <>
                , roughly <strong>{due.next.est_months_away} month{due.next.est_months_away === 1 ? "" : "s"}</strong>
                {proj && <> (≈ {proj})</>} at the stated driving pace
              </>
            )}
            .{due.next.wraps_cycle && " The published grid ends before then, so the cycle restarts."}
          </p>
          <p className="talk">
            “Let's pencil in your {fmtMiles(due.next.milestone)}-mile visit
            {proj ? ` around ${proj}` : ""} — I'll set the reminder before you leave.”
          </p>
        </div>
      </div>
    </div>
  );
}
