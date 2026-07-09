/**
 * Left rail: the vehicle write-up, in RO-header order.
 * Cascading selects — every change narrows the remaining options via /api/options.
 * Fields with exactly one valid value are auto-filled by App (noted inline).
 */
import type { OptionsResponse, VehicleFilters } from "../api";

export type FilterField =
  | "year"
  | "model"
  | "trim"
  | "engine_type"
  | "engine_size"
  | "engine"
  | "drivetrain"
  | "transmission"
  | "driving_condition";

export const FIELD_ORDER: FilterField[] = [
  "year",
  "model",
  "trim",
  "engine_type",
  "engine_size",
  "engine",
  "drivetrain",
  "transmission",
  "driving_condition",
];

interface Props {
  filters: VehicleFilters;
  options: OptionsResponse | null;
  autoFilled: Set<FilterField>;
  onField: (field: FilterField, value: string) => void;
  mileage: string;
  onMileage: (v: string) => void;
  monthly: string;
  onMonthly: (v: string) => void;
  mileageError: string | null;
  status: { kind: "ok" | "warn"; text: string } | null;
}

function Select(props: {
  field: FilterField;
  label: string;
  value: string;
  values: Array<string | number>;
  disabled: boolean;
  auto: boolean;
  onField: Props["onField"];
  render?: (v: string | number) => string;
}) {
  const { field, label, value, values, disabled, auto, onField, render } = props;
  return (
    <div className="field">
      <label htmlFor={`f-${field}`}>{label}</label>
      <select
        id={`f-${field}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onField(field, e.target.value)}
      >
        <option value="">{disabled ? "—" : "Select…"}</option>
        {values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {render ? render(v) : String(v)}
          </option>
        ))}
      </select>
      {auto && <span className="auto-note">auto — only one match</span>}
    </div>
  );
}

export function VehicleForm(p: Props) {
  const o = p.options;
  const f = p.filters;
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

  // Variant select only matters when type+size leave more than one full engine string.
  const showVariant = Boolean(f.engine_type && f.engine_size && o && o.engines.length > 1);

  return (
    <aside className="rail">
      <div className="rail-brand">
        Maintenance Cockpit
        <small>TOYOTA · XTIME SCHEDULE LOOKUP · READ-ONLY</small>
      </div>

      <div className="rail-section-label">Vehicle</div>

      <Select field="year" label="Year" value={s(f.year)} values={o?.years ?? []}
        disabled={!o} auto={p.autoFilled.has("year")} onField={p.onField} />
      <Select field="model" label="Model" value={s(f.model)} values={o?.models ?? []}
        disabled={!f.year} auto={p.autoFilled.has("model")} onField={p.onField} />
      <Select field="trim" label="Trim" value={s(f.trim)} values={o?.trims ?? []}
        disabled={!f.model} auto={p.autoFilled.has("trim")} onField={p.onField} />
      <Select field="engine_type" label="Engine" value={s(f.engine_type)} values={o?.engine_types ?? []}
        disabled={!f.trim} auto={p.autoFilled.has("engine_type")} onField={p.onField} />
      <Select field="engine_size" label="Engine size" value={s(f.engine_size)} values={o?.engine_sizes ?? []}
        disabled={!f.engine_type} auto={p.autoFilled.has("engine_size")} onField={p.onField} />
      {showVariant && (
        <Select field="engine" label="Engine variant" value={s(f.engine)}
          values={(o?.engines ?? []).map((e) => e.engine)}
          disabled={false} auto={p.autoFilled.has("engine")} onField={p.onField}
          render={(v) => String(v)} />
      )}
      <Select field="drivetrain" label="Drivetrain" value={s(f.drivetrain)} values={o?.drivetrains ?? []}
        disabled={!f.engine} auto={p.autoFilled.has("drivetrain")} onField={p.onField} />
      <Select field="transmission" label="Transmission" value={s(f.transmission)} values={o?.transmissions ?? []}
        disabled={!f.drivetrain} auto={p.autoFilled.has("transmission")} onField={p.onField} />
      <Select field="driving_condition" label="Driving condition" value={s(f.driving_condition)}
        values={o?.driving_conditions ?? []}
        disabled={!f.transmission} auto={p.autoFilled.has("driving_condition")} onField={p.onField} />

      <div className="rail-section-label">Odometer</div>

      <div className="field">
        <label htmlFor="f-mileage">Current mileage</label>
        <input
          id="f-mileage"
          inputMode="numeric"
          placeholder="e.g. 68500"
          value={p.mileage}
          onChange={(e) => p.onMileage(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="f-monthly">Avg monthly miles (optional)</label>
        <input
          id="f-monthly"
          inputMode="numeric"
          placeholder="e.g. 1200"
          value={p.monthly}
          onChange={(e) => p.onMonthly(e.target.value)}
        />
        <span className="auto-note">used to estimate months to next visit</span>
      </div>

      {p.mileageError && <div className="error-box">{p.mileageError}</div>}

      <div className="rail-status">
        {p.status ? (
          <span className={p.status.kind}>{p.status.text}</span>
        ) : (
          <span>Select a vehicle to begin.</span>
        )}
      </div>
    </aside>
  );
}
