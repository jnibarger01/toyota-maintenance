import { useEffect, useState } from "react";
import {
  fetchYears, fetchModels, fetchOptions, postLookup, fetchGrid,
  type GridResponse, type LookupBody, type LookupResult, type OptionsResponse,
} from "./api";
import { YearSelector } from "./components/YearSelector";
import { ModelGrid } from "./components/ModelGrid";
import { VehicleDetailsForm } from "./components/VehicleDetailsForm";
import { MaintenanceResults } from "./components/MaintenanceResults";
import { PrintSheet } from "./components/PrintSheet";
import { LoadingState, EmptyState, ErrorState } from "./components/States";

type Step = "year" | "model" | "details" | "results";

interface AppState {
  step: Step;
  years: number[];
  year: number | null;
  models: string[];
  model: string | null;
  options: OptionsResponse | null;
  body: LookupBody | null;
  result: LookupResult | null;
  grid: GridResponse | null;
  loading: string | null;
  error: string | null;
}

const initial: AppState = {
  step: "year", years: [], year: null, models: [], model: null,
  options: null, body: null, result: null, grid: null, loading: null, error: null,
};

export default function App() {
  const [s, setS] = useState<AppState>(initial);

  const fail = (e: unknown) =>
    setS((p) => ({ ...p, loading: null, error: e instanceof Error ? e.message : "request failed" }));

  const loadYears = () => {
    setS((p) => ({ ...p, loading: "Loading years…", error: null }));
    fetchYears()
      .then((years) => setS((p) => ({ ...p, years, loading: null })))
      .catch(fail);
  };

  useEffect(loadYears, []);

  const pickYear = (year: number) => {
    setS((p) => ({ ...p, year, loading: "Loading models…", error: null }));
    fetchModels(year)
      .then((models) => setS((p) => ({ ...p, models, step: "model", loading: null })))
      .catch(fail);
  };

  const pickModel = (model: string) => {
    setS((p) => ({ ...p, model, loading: "Loading options…", error: null }));
    fetchOptions(s.year!, model)
      .then((options) => setS((p) => ({ ...p, options, step: "details", loading: null })))
      .catch(fail);
  };

  const submit = (body: LookupBody) => {
    setS((p) => ({ ...p, body, loading: "Looking up schedule…", error: null }));
    Promise.all([postLookup(body), fetchGrid(body)])
      .then(([result, grid]) => setS((p) => ({ ...p, result, grid, step: "results", loading: null })))
      .catch(fail);
  };

  return (
    <div className="app">
      <header className="app-header no-print">
        {/* Official Hendrick Automotive Group mark (from brand-standard EPS, unaltered).
            A dealership-specific logo must come from HendrickBrandSupport.com. */}
        <img className="brand-logo" src="/brand/hag-color.png" alt="Hendrick Automotive Group™" />
        <div className="app-title-block">
          <h1>Toyota Maintenance Cockpit</h1>
          <span className="app-tag">Hendrick Toyota Merriam · Service Department · factory schedule lookup</span>
        </div>
      </header>
      <div className="speed-lines no-print" aria-hidden="true"><span /><span /><span /></div>

      <main className="app-main no-print">
        {s.error ? (
          <ErrorState
            message={s.error}
            onRetry={() => {
              if (s.step === "year") loadYears();
              else setS((p) => ({ ...p, error: null }));
            }}
          />
        ) : s.loading ? (
          <LoadingState label={s.loading} />
        ) : s.step === "year" ? (
          s.years.length === 0
            ? <EmptyState title="No model years available" hint="Check that the lookup API is running." />
            : <YearSelector years={s.years} onSelect={pickYear} />
        ) : s.step === "model" ? (
          s.models.length === 0
            ? <EmptyState title="No models for this year" />
            : <ModelGrid year={s.year!} models={s.models} onSelect={pickModel} onBack={() => setS((p) => ({ ...p, step: "year" }))} />
        ) : s.step === "details" && s.options ? (
          <VehicleDetailsForm
            year={s.year!} model={s.model!} options={s.options}
            onSubmit={submit}
            onBack={() => setS((p) => ({ ...p, step: "model" }))}
          />
        ) : s.step === "results" && s.result && s.grid && s.body ? (
          <MaintenanceResults
            result={s.result} grid={s.grid} body={s.body}
            onStartOver={() => setS({ ...initial, years: s.years })}
          />
        ) : null}
      </main>

      {s.result ? <PrintSheet result={s.result} /> : null}

      <footer className="app-footer no-print">
        Factory maintenance schedules, straight from the source — no VIN needed, no guesswork.
        Prices appear only when they come from our own service menu.
      </footer>
    </div>
  );
}
