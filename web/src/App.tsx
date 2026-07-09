/**
 * Cockpit orchestration.
 *
 * Flow: filters -> /api/options (cascade + auto-fill single matches)
 *              -> /api/schedules/resolve (exactly one schedule, fail-closed)
 *              -> /api/schedules/:key (full item matrix, once per schedule)
 *              -> /api/schedules/:key/due?mileage&monthly_miles (debounced)
 *
 * The UI holds no persistent state and performs no writes — every keystroke is
 * answered from the read-only SQLite lookup DB.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  fmtMiles,
  shortHash,
  type DueResponse,
  type OptionsResponse,
  type ScheduleDetail,
  type ScheduleRow,
  type VehicleFilters,
} from "./api";
import { FIELD_ORDER, VehicleForm, type FilterField } from "./components/VehicleForm";
import { MilestoneRail } from "./components/MilestoneRail";
import { GridView } from "./components/GridView";
import { ListView } from "./components/ListView";
import { GuideView } from "./components/GuideView";
import { PrintSheet } from "./components/PrintSheet";

type Tab = "grid" | "list" | "guide" | "print";

const MAX_MILEAGE = 500_000;
const MAX_MONTHLY = 15_000;

/** Gate: a field is eligible (for user input or auto-fill) once its predecessor is chosen. */
function gateSatisfied(field: FilterField, f: VehicleFilters): boolean {
  switch (field) {
    case "year": return true;
    case "model": return f.year !== undefined && f.year !== "";
    case "trim": return !!f.model;
    case "engine_type": return !!f.trim;
    case "engine_size": return !!f.engine_type;
    case "engine": return !!f.engine_type && !!f.engine_size;
    case "drivetrain": return !!f.engine;
    case "transmission": return !!f.drivetrain;
    case "driving_condition": return !!f.transmission;
  }
}

function optionValues(field: FilterField, o: OptionsResponse): Array<string | number> {
  switch (field) {
    case "year": return o.years;
    case "model": return o.models;
    case "trim": return o.trims;
    case "engine_type": return o.engine_types;
    case "engine_size": return o.engine_sizes;
    case "engine": return o.engines.map((e) => e.engine);
    case "drivetrain": return o.drivetrains;
    case "transmission": return o.transmissions;
    case "driving_condition": return o.driving_conditions;
  }
}

export default function App() {
  const [filters, setFilters] = useState<VehicleFilters>({});
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [autoFilled, setAutoFilled] = useState<Set<FilterField>>(new Set());
  const [resolved, setResolved] = useState<ScheduleRow | null>(null);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const [mileage, setMileage] = useState("");
  const [monthly, setMonthly] = useState("");
  const [due, setDue] = useState<DueResponse | null>(null);
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [tab, setTab] = useState<Tab>("list");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const optionsReq = useRef(0);
  const dueReq = useRef(0);

  const onField = useCallback((field: FilterField, value: string) => {
    setFilters((prev) => {
      const next: VehicleFilters = { ...prev };
      if (field === "year") next.year = value === "" ? undefined : Number(value);
      else next[field] = value === "" ? undefined : value;
      // Clear everything downstream of the changed field.
      const idx = FIELD_ORDER.indexOf(field);
      for (const f of FIELD_ORDER.slice(idx + 1)) {
        if (f === "year") next.year = undefined;
        else next[f] = undefined;
      }
      return next;
    });
    setAutoFilled((prev) => {
      const idx = FIELD_ORDER.indexOf(field);
      const keep = new Set([...prev].filter((f) => FIELD_ORDER.indexOf(f) < idx));
      return keep;
    });
    setResolved(null);
    setResolveMsg(null);
    setDue(null);
    setDetail(null);
  }, []);

  // 1. Options cascade + auto-fill of single-choice fields.
  useEffect(() => {
    const id = ++optionsReq.current;
    api.options(filters)
      .then((o) => {
        if (id !== optionsReq.current) return;
        setOptions(o);
        setFetchError(null);
        // Auto-fill the first eligible unset field that has exactly one value.
        for (const field of FIELD_ORDER) {
          const current = field === "year" ? filters.year : filters[field];
          if (current !== undefined && current !== "") continue;
          if (!gateSatisfied(field, filters)) continue;
          const vals = optionValues(field, o);
          if (vals.length === 1) {
            setAutoFilled((prev) => new Set(prev).add(field));
            setFilters((prev) => ({
              ...prev,
              [field]: field === "year" ? Number(vals[0]) : String(vals[0]),
            }));
          }
          break; // only consider the first open field; cascade handles the rest
        }
      })
      .catch((e: Error) => {
        if (id !== optionsReq.current) return;
        setFetchError(`Options lookup failed: ${e.message}. Is the API running?`);
      });
  }, [filters]);

  // 2. Resolve to exactly one schedule when every dimension is chosen.
  const complete =
    filters.year !== undefined &&
    !!filters.model && !!filters.trim && !!filters.engine &&
    !!filters.drivetrain && !!filters.transmission && !!filters.driving_condition;

  useEffect(() => {
    if (!complete) return;
    let cancelled = false;
    api.resolve(filters)
      .then((r) => {
        if (cancelled) return;
        if (r.count === 1) {
          setResolved(r.schedules[0]);
          setResolveMsg(null);
        } else {
          setResolved(null);
          setResolveMsg(`Selection is ambiguous (${r.count} schedules) — pick the engine variant.`);
        }
      })
      .catch((e: Error & { status?: number }) => {
        if (cancelled) return;
        setResolved(null);
        setResolveMsg(e.status === 404 ? "No factory schedule matches these selections." : e.message);
      });
    return () => { cancelled = true; };
  }, [complete, filters]);

  // 3. Full item matrix, once per schedule (feeds the Grid tab).
  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    api.schedule(resolved.schedule_key)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e: Error) => { if (!cancelled) setFetchError(`Schedule detail failed: ${e.message}`); });
    return () => { cancelled = true; };
  }, [resolved]);

  // Mileage / monthly validation (mirrors server limits).
  const mileageNum = /^\d+$/.test(mileage.trim()) ? Number(mileage.trim()) : NaN;
  const mileageValid = Number.isInteger(mileageNum) && mileageNum >= 1 && mileageNum <= MAX_MILEAGE;
  const monthlyNum = monthly.trim() === "" ? null : /^\d+$/.test(monthly.trim()) ? Number(monthly.trim()) : NaN;
  const monthlyValid = monthlyNum === null || (Number.isInteger(monthlyNum) && monthlyNum >= 0 && monthlyNum <= MAX_MONTHLY);

  const mileageError =
    mileage.trim() !== "" && !mileageValid
      ? `Mileage must be a whole number 1–${MAX_MILEAGE.toLocaleString("en-US")}.`
      : monthlyNum !== null && !monthlyValid
        ? `Monthly miles must be 0–${MAX_MONTHLY.toLocaleString("en-US")}.`
        : null;

  // 4. Due lookup — debounced against odometer typing.
  useEffect(() => {
    if (!resolved || !mileageValid || !monthlyValid) { setDue(null); return; }
    const id = ++dueReq.current;
    const t = setTimeout(() => {
      api.due(resolved.schedule_key, mileageNum, monthlyNum)
        .then((d) => {
          if (id !== dueReq.current) return;
          setDue(d);
          setFetchError(null);
        })
        .catch((e: Error) => {
          if (id !== dueReq.current) return;
          setFetchError(`Due lookup failed: ${e.message}`);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [resolved, mileageNum, mileageValid, monthlyNum, monthlyValid]);

  const status = useMemo(() => {
    if (resolveMsg) return { kind: "warn" as const, text: resolveMsg };
    if (resolved) return { kind: "ok" as const, text: `Schedule ${shortHash(resolved.schedule_key)} · ready` };
    if (options) return { kind: "ok" as const, text: `${options.matching_schedules.toLocaleString("en-US")} schedules match` };
    return null;
  }, [options, resolved, resolveMsg]);

  const ready = due !== null;

  return (
    <>
      <div className="app">
        <VehicleForm
          filters={filters}
          options={options}
          autoFilled={autoFilled}
          onField={onField}
          mileage={mileage}
          onMileage={setMileage}
          monthly={monthly}
          onMonthly={setMonthly}
          mileageError={mileageError}
          status={status}
        />

        <main className="main">
          {fetchError && <div className="error-box">{fetchError}</div>}

          {!ready && (
            <div className="notice">
              <h2 style={{ fontFamily: "var(--display)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>
                Vehicle write-up
              </h2>
              Select year, model, trim, engine, drivetrain, transmission, and driving condition, then
              enter the current odometer reading. Results come from the local factory-schedule
              database — no network lookup, nothing is saved.
            </div>
          )}

          {ready && due && (
            <>
              <header className="masthead">
                <div>
                  <h1 className="vehicle-title">
                    {due.vehicle.year} {due.vehicle.model} {due.vehicle.trim}
                  </h1>
                  <div className="vehicle-sub">
                    {due.vehicle.engine} · {due.vehicle.drivetrain} · {due.vehicle.transmission} ·{" "}
                    {due.vehicle.driving_condition} schedule
                  </div>
                </div>
                <div className="odo-block">
                  <div className="odo-num">{fmtMiles(due.mileage.entered)}</div>
                  <div className="odo-label">Odometer · miles</div>
                </div>
              </header>

              <div className="strip">
                {!due.schedule_empty && (
                  <>
                    <span className="badge due">Due · {fmtMiles(due.due_now.milestone)} mi · {due.due_now.items.length} items</span>
                    <span className="badge next">Next · {fmtMiles(due.next.milestone)} mi · in {fmtMiles(due.next.miles_away)} mi</span>
                  </>
                )}
                {due.vehicle.driving_condition === "Severe" && <span className="badge severe">Severe schedule</span>}
                {due.mileage.extrapolated && <span className="badge warn">Beyond published grid — cycle repeated</span>}
                {due.schedule_empty && <span className="badge warn">Source schedule has no items</span>}
              </div>

              {due.schedule_empty ? (
                <div className="notice alert" style={{ marginTop: 14 }}>
                  <strong>No service items in the source schedule.</strong> This configuration's
                  factory schedule arrived with zero items (a known upstream state for some EV and
                  extraction-gap configurations). Nothing is being hidden — there is simply no
                  interval data to present. Verify in Xtime/TIS before advising the customer.
                </div>
              ) : (
                <>
                  <MilestoneRail
                    grid={due.grid}
                    snapped={due.mileage.snapped_milestone}
                    next={due.next.milestone}
                    cycleMileage={due.mileage.cycle_mileage}
                    entered={due.mileage.entered}
                    extrapolated={due.mileage.extrapolated}
                  />

                  <div className="tabs" role="tablist" aria-label="Result views">
                    {(["grid", "list", "guide", "print"] as Tab[]).map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={tab === t}
                        className="tab"
                        onClick={() => setTab(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="tabpanel">
                    {tab === "grid" && (detail ? <GridView due={due} detail={detail} /> : <div className="notice">Loading item matrix…</div>)}
                    {tab === "list" && <ListView due={due} />}
                    {tab === "guide" && <GuideView due={due} />}
                    {tab === "print" && (
                      <div>
                        <p style={{ marginTop: 0 }}>
                          <button className="btn-primary" onClick={() => window.print()}>
                            Print customer sheet
                          </button>
                        </p>
                        <div className="sheet-preview">
                          <PrintSheet due={due} />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="card" style={{ marginTop: 18 }}>
                <h3>Source &amp; provenance</h3>
                <dl className="prov">
                  <div><dt>Source</dt><dd>{due.provenance.source}</dd></div>
                  <div><dt>Schedule key</dt><dd>{due.provenance.schedule_key}</dd></div>
                  <div><dt>Content hash</dt><dd>{due.provenance.schedule_hash}</dd></div>
                  <div><dt>Schedule updated</dt><dd>{due.provenance.last_updated ?? "—"}</dd></div>
                  <div><dt>Airtable record</dt><dd>{due.provenance.airtable_record_id ?? "—"}</dd></div>
                  <div><dt>Imported to Airtable</dt><dd>{due.provenance.airtable_created_at ?? "—"}</dd></div>
                  <div><dt>Lookup DB built</dt><dd>{due.provenance.db_built_at ?? "—"} (ETL {due.provenance.etl_version ?? "—"})</dd></div>
                </dl>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Hidden on screen; the only thing visible when printing. */}
      {due && !due.schedule_empty && (
        <div className="print-root">
          <PrintSheet due={due} />
        </div>
      )}
    </>
  );
}
