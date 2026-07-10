import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOptions, type LookupBody, type OptionsResponse } from "../api";

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

const initial: DetailsFormValue = {
  trim: "", engine: "", engineSize: "", drivetrain: "", transmission: "", drivingCondition: "",
  mileage: "",
  avgMonthly: "",
};

// Match the visible form order so a later choice never clears fields the user
// already completed above it.
const cascadeFields = ["trim", "engine", "engineSize", "transmission", "drivetrain"] as const;
type CascadeField = typeof cascadeFields[number];
type ChoiceField = CascadeField | "drivingCondition";

function parseMileage(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 500000 ? n : null;
}

function pick(value: string, values: string[], autoFill: boolean): string {
  if (value && values.includes(value)) return value;
  return autoFill && values.length === 1 ? values[0] : "";
}

function valid(value: string, values: string[]): boolean {
  return value === "" || values.includes(value);
}

function fullEngines(options: OptionsResponse): string[] {
  return [...new Set(options.engines.map((option) => option.engine).filter(Boolean))];
}

function reconcile(v: DetailsFormValue, options: OptionsResponse): DetailsFormValue {
  return {
    ...v,
    trim: pick(v.trim, options.trims, true),
    engine: pick(v.engine, fullEngines(options), true),
    engineSize: pick(v.engineSize, options.engine_sizes, true),
    drivetrain: pick(v.drivetrain, options.drivetrains, true),
    transmission: pick(v.transmission, options.transmissions, true),
    drivingCondition: pick(v.drivingCondition, options.driving_conditions, false),
  };
}

/** Step 3 — the service-lane details form. */
export function VehicleDetailsForm({ year, model, options, onSubmit, backTo }: {
  year: number;
  model: string;
  options: OptionsResponse;
  onSubmit: (body: LookupBody) => void | Promise<void>;
  backTo: string;
}) {
  const [v, setV] = useState<DetailsFormValue>(initial);
  const [currentOptions, setCurrentOptions] = useState(options);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionError, setOptionError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(0);
  const setLocal = (k: keyof DetailsFormValue) => (val: string) => setV((s) => ({ ...s, [k]: val }));

  useEffect(() => {
    setCurrentOptions(options);
    setV(initial);
    setOptionError(null);
    setSubmitError(null);
  }, [year, model, options]);

  // Auto-fill any dimension that only has one available value.
  useEffect(() => {
    setV((s) => reconcile(s, currentOptions));
  }, [currentOptions]);

  const filtersThrough = (next: DetailsFormValue, key: CascadeField) => {
    const through = cascadeFields.indexOf(key);
    return {
      year,
      model,
      ...(through >= 0 && next.trim ? { trim: next.trim } : {}),
      ...(through >= 1 && next.engine ? { engine: next.engine } : {}),
      ...(through >= 2 && next.engineSize ? { engineSize: next.engineSize } : {}),
      ...(through >= 3 && next.transmission ? { transmission: next.transmission } : {}),
      ...(through >= 4 && next.drivetrain ? { drivetrain: next.drivetrain } : {}),
    };
  };

  const setCascade = (key: CascadeField) => async (val: string) => {
    const changed = cascadeFields.indexOf(key);
    const next = { ...v, [key]: val };
    for (const field of cascadeFields.slice(changed + 1)) next[field] = "";
    setV(next);
    setOptionLoading(true);
    setOptionError(null);
    const id = ++requestId.current;
    try {
      const fresh = await fetchOptions(filtersThrough(next, key));
      if (id !== requestId.current) return;
      setCurrentOptions(fresh);
      setV((s) => reconcile(s, fresh));
    } catch (e) {
      if (id !== requestId.current) return;
      setOptionError(e instanceof Error ? e.message : "options failed");
    } finally {
      if (id === requestId.current) setOptionLoading(false);
    }
  };

  const retryOptions = async () => {
    setOptionLoading(true);
    setOptionError(null);
    const id = ++requestId.current;
    try {
      const fresh = await fetchOptions({
        year,
        model,
        ...(v.trim ? { trim: v.trim } : {}),
        ...(v.engine ? { engine: v.engine } : {}),
        ...(v.engineSize ? { engineSize: v.engineSize } : {}),
        ...(v.transmission ? { transmission: v.transmission } : {}),
        ...(v.drivetrain ? { drivetrain: v.drivetrain } : {}),
      });
      if (id !== requestId.current) return;
      setCurrentOptions(fresh);
      setV((current) => reconcile(current, fresh));
    } catch (error) {
      if (id !== requestId.current) return;
      setOptionError(error instanceof Error ? error.message : "options failed");
    } finally {
      if (id === requestId.current) setOptionLoading(false);
    }
  };

  const mileage = parseMileage(v.mileage);
  const avgMonthly = v.avgMonthly === "" ? null : Number(v.avgMonthly);
  const avgOk = avgMonthly === null || (Number.isFinite(avgMonthly) && avgMonthly >= 0 && avgMonthly <= 15000);
  const comboOk =
    valid(v.trim, currentOptions.trims) &&
    valid(v.engine, fullEngines(currentOptions)) &&
    valid(v.engineSize, currentOptions.engine_sizes) &&
    valid(v.drivetrain, currentOptions.drivetrains) &&
    valid(v.transmission, currentOptions.transmissions) &&
    valid(v.drivingCondition, currentOptions.driving_conditions);
  const exactConfigOk =
    (currentOptions.trims.length === 0 || v.trim !== "") &&
    (fullEngines(currentOptions).length === 0 || v.engine !== "") &&
    (currentOptions.engine_sizes.length === 0 || v.engineSize !== "") &&
    (currentOptions.drivetrains.length === 0 || v.drivetrain !== "") &&
    (currentOptions.transmissions.length === 0 || v.transmission !== "");
  // Customer presentations must resolve one exact configuration. In particular,
  // omitted vehicle dimensions can match several schedules and select the wrong one.
  const ready = !optionLoading && !submitLoading && !optionError && comboOk && exactConfigOk && v.drivingCondition !== "" && mileage !== null && avgOk;

  const submit = async () => {
    if (!ready || mileage === null) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      await onSubmit({
        year, model,
        trim: v.trim,
        engine: v.engine || undefined,
        engineSize: v.engineSize || undefined,
        drivetrain: v.drivetrain,
        transmission: v.transmission || undefined,
        drivingCondition: v.drivingCondition,
        currentMileage: mileage,
        ...(avgMonthly !== null ? { avgMonthlyMileage: avgMonthly } : {}),
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to resolve this configuration.");
      setSubmitLoading(false);
    }
  };

  const select = (id: string, label: string, values: string[], key: CascadeField, required = false) => (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}{required ? " *" : ""}</span>
      <select
        id={id}
        value={v[key]}
        onChange={(e) => void setCascade(key)(e.target.value)}
        disabled={optionLoading}
        required={required}
        aria-required={required}
      >
        {values.length !== 1 ? <option value="">{required ? "Select…" : "Any"}</option> : null}
        {values.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  const choose = (key: ChoiceField, option: string) => {
    if (key === "drivingCondition") setLocal("drivingCondition")(option);
    else void setCascade(key)(option);
  };

  const chips = (label: string, values: string[], key: ChoiceField) => (
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">{label} *</span>
      <div className="chip-row">
        {values.map((o) => (
          <button
            key={o}
            type="button"
            className="chip"
            aria-pressed={v[key] === o}
            disabled={optionLoading}
            onClick={() => choose(key, o)}
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
        <Link className="btn btn-link" to={backTo}>Change model</Link>
      </div>

      <form
        className="details-form panel"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        <div className="form-grid">
          {select("f-trim", "Trim", currentOptions.trims, "trim", currentOptions.trims.length > 0)}
          {select("f-engine", "Engine", fullEngines(currentOptions), "engine", fullEngines(currentOptions).length > 0)}
          {select("f-size", "Engine size", currentOptions.engine_sizes, "engineSize", currentOptions.engine_sizes.length > 0)}
          {select("f-trans", "Transmission", currentOptions.transmissions, "transmission", currentOptions.transmissions.length > 0)}
        </div>

        {chips("Drivetrain", currentOptions.drivetrains, "drivetrain")}
        {chips("Driving condition", currentOptions.driving_conditions, "drivingCondition")}

        <div className="form-grid">
          <label className="field" htmlFor="f-mileage">
            <span className="field-label">Current mileage *</span>
            <input
              id="f-mileage" inputMode="numeric" value={v.mileage}
              required aria-required="true"
              onChange={(e) => setLocal("mileage")(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
          <label className="field" htmlFor="f-avg">
            <span className="field-label">Avg monthly mileage</span>
            <input
              id="f-avg" inputMode="numeric" value={v.avgMonthly}
              onChange={(e) => setLocal("avgMonthly")(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            {submitLoading ? "Resolving configuration…" : "Show Details"}
          </button>
          {optionLoading ? <span className="field-hint">Loading valid options…</span> : null}
          {optionError ? (
            <span className="field-hint" role="alert">
              {optionError} <button type="button" className="btn btn-link" onClick={() => void retryOptions()}>Try again</button>
            </span>
          ) : null}
          {submitError ? <span className="field-hint" role="alert">{submitError}</span> : null}
          {!ready && !optionLoading && !optionError ? <span className="field-hint">Select every available vehicle detail, driving condition, and a valid mileage.</span> : null}
        </div>
      </form>
    </section>
  );
}
