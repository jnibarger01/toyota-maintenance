import { useState } from "react";
import type { GridResponse, GuideResponse, LookupBody, LookupResult } from "../api";
import { postGuide } from "../api";
import { MaintenanceGrid } from "./MaintenanceGrid";
import { MaintenanceList } from "./MaintenanceList";
import { MaintenanceGuide } from "./MaintenanceGuide";
import { SourceBadge } from "./SourceBadge";
import { LoadingState, ErrorState } from "./States";

type Tab = "grid" | "list" | "guide";

/** Step 4 — results header, tabs (Grid | List | Guide), and the print action. */
export function MaintenanceResults({ result, grid, body, onStartOver }: {
  result: LookupResult;
  grid: GridResponse;
  body: LookupBody;
  onStartOver: () => void;
}) {
  const [tab, setTab] = useState<Tab>("grid");
  const [guide, setGuide] = useState<GuideResponse | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);

  const v = result.vehicle;

  const loadGuide = async () => {
    setGuideLoading(true);
    setGuideError(null);
    try {
      setGuide(await postGuide(body));
    } catch (e) {
      setGuideError(e instanceof Error ? e.message : "guide failed");
    } finally {
      setGuideLoading(false);
    }
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "guide" && !guide && !guideLoading) void loadGuide();
  };

  return (
    <section aria-labelledby="results-heading">
      <div className="results-header panel">
        <div>
          <h2 id="results-heading" className="results-title">
            {v.year} {v.make} {v.model}{v.trim ? ` ${v.trim}` : ""}
          </h2>
          <p className="results-sub">
            {v.engine ?? "—"} · {v.drivetrain ?? "—"} · {v.transmission ?? "—"} · {v.driving_condition} schedule
            &nbsp;·&nbsp; Odometer {result.mileage.current.toLocaleString("en-US")} mi
          </p>
          {result.resolution.relaxed_fields.length > 0 ? (
            <p className="results-note">
              Closest configuration used ({result.resolution.relaxed_fields.join(", ")} did not match a listed configuration).
            </p>
          ) : null}
        </div>
        <div className="results-actions">
          <SourceBadge source={result.source} />
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn btn-link" onClick={onStartOver}>Start over</button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Result views">
        {(["grid", "list", "guide"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="tab"
            onClick={() => openTab(t)}
          >
            {t === "grid" ? "Grid" : t === "list" ? "List" : "Guide"}
          </button>
        ))}
      </div>

      <div className="tab-panel panel">
        {tab === "grid" ? <MaintenanceGrid grid={grid} /> : null}
        {tab === "list" ? <MaintenanceList result={result} /> : null}
        {tab === "guide" ? (
          guideLoading ? <LoadingState label="Building guide…" />
          : guideError ? <ErrorState message={guideError} onRetry={() => void loadGuide()} />
          : guide ? <MaintenanceGuide guide={guide} />
          : null
        ) : null}
      </div>
    </section>
  );
}
