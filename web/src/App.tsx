import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { CarFront, LayoutGrid, Printer } from "lucide-react";
import { SourceBadge } from "./components/SourceBadge";
import {
  CockpitPage,
  ModelsPage,
  NotFoundPage,
  PrintPreviewPage,
  SchedulePage,
  VehiclePage,
} from "./routes/pages";
import type { HeaderPresentation, ShellOutletContext } from "./routes/shellContext";

function AppShell() {
  const location = useLocation();
  const [headerPresentation, setHeaderPresentation] = useState<HeaderPresentation | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const results = location.pathname.startsWith("/schedule/");
  const context = useMemo<ShellOutletContext>(() => ({ setHeaderPresentation }), []);
  const vehicleMatch = location.pathname.match(/^\/(?:vehicle|schedule)\/([^/]+)\/([^/]+)/);
  const vehicleTo = vehicleMatch ? `/vehicle/${vehicleMatch[1]}/${vehicleMatch[2]}` : "/cockpit";

  useEffect(() => {
    if (!results) setHeaderPresentation(null);
  }, [results]);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="app" data-step={results ? "results" : "selection"}>
      <header className="app-header no-print">
        <div className="brand-lockup">
          <img className="brand-logo" src="/brand/hag-color.png" alt="Hendrick Automotive Group™" />
        </div>
        <div className="app-title-block">
          <h1>Maintenance Cockpit</h1>
          <span className="app-tag">Hendrick Toyota Merriam · Factory schedule presentation</span>
        </div>
        {headerPresentation ? (
          <div className="header-actions">
            <SourceBadge source={headerPresentation.source} />
            <Link
              className={headerPresentation.printCount === 0 ? "header-print disabled" : "header-print"}
              aria-disabled={headerPresentation.printCount === 0}
              onClick={(event) => { if (headerPresentation.printCount === 0) event.preventDefault(); }}
              to={headerPresentation.printTo}
            >
              <Printer size={21} aria-hidden="true" />
              <span>Print</span>
              <span className="print-count num">{headerPresentation.printCount}</span>
              <span className="sr-only">
                {` included ${headerPresentation.printCount === 1 ? "task" : "tasks"} — open print preview`}
              </span>
            </Link>
          </div>
        ) : null}
      </header>

      <div className="app-body no-print">
        <nav className="app-rail" aria-label="Cockpit navigation">
          <NavLink
            to="/cockpit"
            className={location.pathname.startsWith("/cockpit") ? "rail-current" : "rail-action"}
          >
            <LayoutGrid size={27} aria-hidden="true" />
            <span className="rail-label">Cockpit</span>
          </NavLink>
          {vehicleMatch ? (
            <NavLink
              to={vehicleTo}
              className={location.pathname.startsWith("/vehicle") || results ? "rail-current" : "rail-action"}
              title="Change vehicle configuration"
            >
              <CarFront size={27} aria-hidden="true" />
              <span className="rail-label">Vehicle</span>
            </NavLink>
          ) : null}
        </nav>

        <div className="app-content">
          <main ref={mainRef} className="app-main" tabIndex={-1}>
            <Outlet context={context} />
          </main>
          <footer className="app-footer">
            Imported factory maintenance schedules, shown without VIN, customer, pricing, labor, or op-code data.
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Exported separately so route tests can use MemoryRouter without nesting routers. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/cockpit" />} />
      <Route path="/schedule/:year/:modelSlug/print" element={<PrintPreviewPage />} />
      <Route element={<AppShell />}>
        <Route path="/cockpit" element={<CockpitPage />} />
        <Route path="/cockpit/:year" element={<ModelsPage />} />
        <Route path="/vehicle/:year/:modelSlug" element={<VehiclePage />} />
        <Route path="/schedule/:year/:modelSlug" element={<SchedulePage />} />
        <Route path="/schedule/:year/:modelSlug/:configId" element={<SchedulePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </BrowserRouter>
  );
}
