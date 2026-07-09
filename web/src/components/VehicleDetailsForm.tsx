import { useEffect, useState } from "react";
import type { LookupBody, OptionsResponse } from "../api";

export interface DetailsFormValue {
  trim: string;
  engine: string;
  engineSize: string;
  drivetrain: string;
  transmission: string;
  drivingCondition: string;
  mileage: string;
  avgMonthly: string;
}

// Demo defaults ONLY in dev builds — production starts blank.
const DEMO = import.meta.env.DEV;
const initial: DetailsFormValue = {
  trim: "", engine: "", engineSize: "", drivetrain: "", transmission: "", drivingCondition: "",
  mileage: DEMO ? "70000" : "",
  avgMonthly: DEMO ? "833" : "",
};

function parseMileage(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 500000 ? n : null;
}

/** Step 3 — the service-lane details form. */
export function VehicleDetailsForm({ year, model, options, onSubmit, onBack }: {
  year: number;
  model: string;
  options: OptionsResponse;
  onSubmit: (body: LookupBody) => void;
  onBack: () => void;
}) {
  const [v, setV] = useState<DetailsFormValue>(initial);
  const set = (k: keyof DetailsFormValue) => (val: string) => setV((s) => ({ ...s, [k]: val }));

  // Auto-fill any dimension that only has one available value.
  useEffect(() => {
    setV((s) => ({
      ...s,
      trim: options.trims.length === 1 ? options.trims[0] : s.trim,
      engine: options.engine_types.length === 1 ? options.engine_types[0] : s.engine,
      engineSize: options.engine_sizes.length === 1 ? options.engine_sizes[0] : s.engineSize,
      drivetrain: options.drivetrains.length === 1 ? options.drivetrains[0] : s.drivetrain,
      transmission: options.transmissions.length === 1 ? options.transmissions[0] : s.transmission,
    }));
  }, [options]);

  const mileage = parseMileage(v.mileage);
  const avgMonthly = v.avgMonthly === "" ? null : Number(v.avgMonthly);
  const avgOk = avgMonthly === null || (Number.isFinite(avgMonthly) && avgMonthly >= 0 && avgMonthly <= 15000);
  // Required before "Show Details": drivetrain, driving condition, valid mileage.
  const ready = v.drivetrain !== "" && v.drivingCondition !== "" && mileage !== null && avgOk;

  const submit = () => {
    if (!ready || mileage === null) return;
    onSubmit({
      year, model,
      trim: v.trim || undefined,
      engine: v.engine || undefined,
      engineSize: v.engineSize || undefined,
      drivetrain: v.drivetrain,
      transmission: v.transmission || undefined,
      drivingCondition: v.drivingCondition,
      currentMileage: mileage,
      ...(avgMonthly !== null ? { avgMonthlyMileage: avgMonthly } : {}),
    });
  };

  const select = (id: string, label: string, values: string[], key: keyof DetailsFormValue, required = false) => (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}{required ? " *" : ""}</span>
      <select id={id} value={v[key]} onChange={(e) => set(key)(e.target.value)}>
        {values.length !== 1 ? <option value="">{required ? "Select…" : "Any"}</option> : null}
        {values.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  const chips = (label: string, values: string[], key: keyof DetailsFormValue) => (
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">{label} *</span>
      <div className="chip-row">
        {values.map((o) => (
          <button
            key={o}
            type="button"
            className="chip"
            aria-pressed={v[key] === o}
            onClick={() => set(key)(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="details-heading">
      <div className="section-header-row">
        <h2 id="details-heading" className="section-header">Vehicle details · {year} {model}</h2>
        <button type="button" className="btn btn-link" onClick={onBack}>Change model</button>
      </div>

      <form
        className="details-form panel"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <div className="form-grid">
          {select("f-trim", "Trim", options.trims, "trim")}
          {select("f-engine", "Engine", options.engine_types, "engine")}
          {select("f-size", "Engine size", options.engine_sizes, "engineSize")}
          {select("f-trans", "Transmission", options.transmissions, "transmission")}
        </div>

        {chips("Drivetrain", options.drivetrains, "drivetrain")}
        {chips("Driving condition", options.driving_conditions, "drivingCondition")}

        <div className="form-grid">
          <label className="field" htmlFor="f-mileage">
            <span className="field-label">Current mileage *</span>
            <input
              id="f-mileage" inputMode="numeric" value={v.mileage}
              onChange={(e) => set("mileage")(e.target.value.replace(/[^0-9]/g, ""))}
            />
            {DEMO ? <span className="field-hint">demo default</span> : null}
          </label>
          <label className="field" htmlFor="f-avg">
            <span className="field-label">Avg monthly mileage</span>
            <input
              id="f-avg" inputMode="numeric" value={v.avgMonthly}
              onChange={(e) => set("avgMonthly")(e.target.value.replace(/[^0-9]/g, ""))}
            />
            {DEMO ? <span className="field-hint">demo default</span> : null}
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            Show Details
          </button>
          {!ready ? <span className="field-hint">Select drivetrain, driving condition, and a valid mileage.</span> : null}
        </div>
      </form>
    </section>
  );
}
