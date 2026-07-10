import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CalendarClock,
  CarFront,
  ClipboardCheck,
  Clock3,
  Gauge,
  LayoutGrid,
  List,
  Pencil,
  Route,
  Settings2,
} from "lucide-react";
import type { GridResponse, GridRow, GuideResponse, LookupBody, LookupResult } from "../api";
import { postGuide } from "../api";
import { MaintenanceGrid } from "./MaintenanceGrid";
import { MaintenanceList } from "./MaintenanceList";
import { MaintenanceGuide } from "./MaintenanceGuide";
import { ServiceDetails } from "./ServiceDetails";
import { LoadingState, ErrorState } from "./States";

type Tab = "grid" | "list" | "guide";

const tabs: Array<{ id: Tab; label: string; Icon: typeof LayoutGrid }> = [
  { id: "grid", label: "Grid", Icon: LayoutGrid },
  { id: "list", label: "List", Icon: List },
  { id: "guide", label: "Owner's Guide", Icon: BookOpen },
];

const formatMiles = (value: number | null): string =>
  value === null ? "Not reached" : `${value.toLocaleString("en-US")} mi`;

function firstInspectableRow(grid: GridResponse): GridRow | null {
  const rows = grid.rows.filter((row) => row.customer_visible !== 0);
  const current = grid.mileage.current_interval;
  return rows.find((row) => current !== null && row.cells[String(current)]) ?? rows[0] ?? null;
}

/** Customer results workstation: context, KPIs, views, and factual task inspector. */
export function MaintenanceResults({
  result,
  grid,
  body,
  view,
  onViewChange,
  selectedTaskName,
  onSelectedTaskChange,
  includedTaskNames,
  onTogglePrintTask,
  changeVehicleTo,
}: {
  result: LookupResult;
  grid: GridResponse;
  body: LookupBody;
  view: Tab;
  onViewChange: (view: Tab) => void;
  selectedTaskName: string | null;
  onSelectedTaskChange: (taskName: string) => void;
  includedTaskNames: string[];
  onTogglePrintTask: (taskName: string) => void;
  changeVehicleTo: string;
}) {
  const [guide, setGuide] = useState<GuideResponse | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleRows = grid.rows.filter((row) => row.customer_visible !== 0);
  const selectedRow = visibleRows.find((row) => row.taskName === selectedTaskName) ?? firstInspectableRow(grid);
  const vehicle = result.vehicle;
  const visibleDue = result.due_now.filter((task) => task.customer_visible !== 0);

  const loadGuide = async () => {
    setGuideLoading(true);
    setGuideError(null);
    try {
      setGuide(await postGuide(body));
    } catch (error) {
      setGuideError(error instanceof Error ? error.message : "guide failed");
    } finally {
      setGuideLoading(false);
    }
  };

  useEffect(() => {
    if (view === "guide" && !guide && !guideLoading && !guideError) void loadGuide();
  }, [view, guide, guideLoading, guideError]);

  const openTab = (next: Tab) => {
    onViewChange(next);
  };

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    openTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };

  const engineLabel = vehicle.engine ?? [vehicle.engine_type, vehicle.engine_size].filter(Boolean).join(" ");

  return (
    <section className="results" aria-labelledby="results-heading">
      <h2 id="results-heading" className="sr-only">
        {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ""} factory maintenance schedule
      </h2>

      <div className="vehicle-context" aria-label="Selected vehicle and schedule context">
        <Link className="context-item context-vehicle" to={changeVehicleTo}>
          <CarFront size={21} aria-hidden="true" />
          <span>{vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ""}</span>
          <Pencil size={17} aria-hidden="true" />
          <span className="sr-only">Change vehicle</span>
        </Link>
        <div className="context-item">
          <Gauge size={20} aria-hidden="true" />
          <span>Odometer {result.mileage.current.toLocaleString("en-US")} mi</span>
        </div>
        {engineLabel ? (
          <div className="context-item">
            <Settings2 size={20} aria-hidden="true" />
            <span>{engineLabel}</span>
          </div>
        ) : null}
        {vehicle.drivetrain ? (
          <div className="context-item">
            <Route size={20} aria-hidden="true" />
            <span>{vehicle.drivetrain}</span>
          </div>
        ) : null}
        <div className="context-item">
          <CalendarClock size={20} aria-hidden="true" />
          <span>{vehicle.driving_condition} schedule</span>
        </div>
      </div>

      {result.resolution.relaxed_fields.length > 0 ? (
        <p className="results-note" role="status">
          Closest configuration used; {result.resolution.relaxed_fields.join(", ")} did not match a published configuration.
        </p>
      ) : null}

      <div className="summary-switcher">
        <div className="kpi-strip" aria-label="Maintenance summary">
          <div className="kpi">
            <ClipboardCheck size={27} aria-hidden="true" />
            <span className="kpi-value num">{visibleDue.length}</span>
            <span className="kpi-label">At this interval</span>
          </div>
          <div className="kpi">
            <Gauge size={27} aria-hidden="true" />
            <span className="kpi-value num">{formatMiles(result.mileage.current_interval)}</span>
            <span className="kpi-label">Current interval</span>
          </div>
          <div className="kpi">
            <Route size={27} aria-hidden="true" />
            <span className="kpi-value num">{formatMiles(result.mileage.next_interval)}</span>
            <span className="kpi-label">Next interval</span>
          </div>
          <div className="kpi">
            <Clock3 size={27} aria-hidden="true" />
            <span className="kpi-value num">
              {result.estimate.months_to_next === null
                ? "Mileage only"
                : `${result.estimate.months_to_next} mo`}
            </span>
            <span className="kpi-label">Estimated time</span>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Schedule views">
          {tabs.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={view === id}
              aria-controls={`panel-${id}`}
              tabIndex={view === id ? 0 : -1}
              className="tab"
              onKeyDown={(event) => moveTabFocus(event, index)}
              onClick={() => openTab(id)}
            >
              <Icon size={19} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="results-workspace">
        <div
          id="panel-grid"
          className="tab-panel panel"
          role="tabpanel"
          aria-labelledby="tab-grid"
          hidden={view !== "grid"}
          tabIndex={view === "grid" ? 0 : -1}
        >
          <MaintenanceGrid
            grid={grid}
            selectedTaskName={selectedRow?.taskName ?? null}
            onSelectTask={(row) => onSelectedTaskChange(row.taskName)}
          />
        </div>
        <div
          id="panel-list"
          className="tab-panel panel"
          role="tabpanel"
          aria-labelledby="tab-list"
          hidden={view !== "list"}
          tabIndex={view === "list" ? 0 : -1}
        >
          <MaintenanceList result={result} />
        </div>
        <div
          id="panel-guide"
          className="tab-panel panel"
          role="tabpanel"
          aria-labelledby="tab-guide"
          hidden={view !== "guide"}
          tabIndex={view === "guide" ? 0 : -1}
        >
          {guideLoading ? <LoadingState label="Loading owner's guide…" />
            : guideError ? <ErrorState message={guideError} onRetry={() => void loadGuide()} />
              : guide ? <MaintenanceGuide guide={guide} />
                : <LoadingState label="Preparing owner's guide…" />}
        </div>

        <ServiceDetails
          row={selectedRow}
          source={result.source}
          currentInterval={result.mileage.current_interval}
          includedInPrint={selectedRow ? includedTaskNames.includes(selectedRow.taskName) : false}
          onTogglePrint={() => { if (selectedRow) onTogglePrintTask(selectedRow.taskName); }}
        />
      </div>
    </section>
  );
}
