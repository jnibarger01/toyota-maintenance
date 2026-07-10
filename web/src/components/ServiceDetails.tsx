import {
  CalendarRange,
  ClipboardList,
  Database,
  FileMinus2,
  FilePlus2,
  Info,
  Tag,
} from "lucide-react";
import type { GridRow, Source } from "../api";

interface ServiceDetailsProps {
  row: GridRow | null;
  source: Source;
  currentInterval: number | null;
  includedInPrint: boolean;
  onTogglePrint: () => void;
}

const miles = (value: number): string => `${value.toLocaleString("en-US")} mi`;

/** Factual schedule inspector. It never invents benefits, procedures, or included work. */
export function ServiceDetails({
  row,
  source,
  currentInterval,
  includedInPrint,
  onTogglePrint,
}: ServiceDetailsProps) {
  if (!row) {
    return (
      <aside className="service-inspector panel" aria-label="Factory task details">
        <div className="inspector-empty">
          <ClipboardList size={30} aria-hidden="true" />
          <h3>Select a factory task</h3>
          <p>Choose a task in the mileage grid to review its schedule facts.</p>
        </div>
      </aside>
    );
  }

  const details = row.details.filter((detail) => detail.customer_visible !== 0);
  const scheduledMiles = [...new Set(details.map((detail) => detail.mileage))].sort((a, b) => a - b);
  const priorities = [...new Set(details.map((detail) => detail.priority).filter((value): value is string => Boolean(value)))];
  const menus = [...new Set(details.map((detail) => detail.menu).filter((value): value is string => Boolean(value)))];
  const sourceDescription = row.description?.trim() || details.find((detail) => detail.description?.trim())?.description?.trim();
  const atCurrentInterval = currentInterval !== null && Boolean(row.cells[String(currentInterval)]);

  return (
    <aside className="service-inspector panel" aria-labelledby="inspector-heading" aria-live="polite">
      <header className="inspector-header">
        <span className="inspector-icon" aria-hidden="true"><ClipboardList size={25} /></span>
        <div>
          <p className="eyebrow">Toyota factory task</p>
          <h3 id="inspector-heading">{row.taskName}</h3>
          {row.advisor_label ? <p className="inspector-service-label">Service label: {row.advisor_label}</p> : null}
        </div>
      </header>

      <div className={atCurrentInterval ? "interval-status current" : "interval-status"}>
        <Info size={18} aria-hidden="true" />
        <span>
          {currentInterval === null
            ? "The first published interval has not been reached."
            : atCurrentInterval
              ? `Listed at the current ${miles(currentInterval)} interval.`
              : `Not listed at the current ${miles(currentInterval)} interval.`}
        </span>
      </div>

      <dl className="inspector-facts">
        <div>
          <dt><Tag size={17} aria-hidden="true" /> Category</dt>
          <dd>{row.category}</dd>
        </div>
        <div>
          <dt><CalendarRange size={17} aria-hidden="true" /> Published mileages</dt>
          <dd>{scheduledMiles.length > 0 ? scheduledMiles.map(miles).join(" · ") : "No mileage detail published"}</dd>
        </div>
        {priorities.length > 0 ? (
          <div>
            <dt><Info size={17} aria-hidden="true" /> Source priority</dt>
            <dd>{priorities.join(" · ")}</dd>
          </div>
        ) : null}
        {menus.length > 0 ? (
          <div>
            <dt><ClipboardList size={17} aria-hidden="true" /> Schedule condition</dt>
            <dd>{menus.join(" · ")}</dd>
          </div>
        ) : null}
        <div>
          <dt><Database size={17} aria-hidden="true" /> Source</dt>
          <dd>{source.source} factory maintenance schedule</dd>
        </div>
      </dl>

      <section className="source-description" aria-label="Source description">
        <h4>Source description</h4>
        <p>{sourceDescription || "No additional description was included in the imported schedule data."}</p>
      </section>

      <button
        type="button"
        className={includedInPrint ? "btn btn-secondary inspector-print" : "btn btn-primary inspector-print"}
        aria-pressed={includedInPrint}
        onClick={onTogglePrint}
      >
        {includedInPrint
          ? <FileMinus2 size={20} aria-hidden="true" />
          : <FilePlus2 size={20} aria-hidden="true" />}
        {includedInPrint ? "Remove from printout" : "Include in printout"}
      </button>
    </aside>
  );
}
