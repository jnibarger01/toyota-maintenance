import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import {
  fetchConfig,
  fetchConfigs,
  fetchGrid,
  fetchModels,
  fetchOptions,
  fetchYears,
  postLookup,
  type ConfigRecord,
  type GridResponse,
  type LookupBody,
  type LookupResult,
  type OptionsResponse,
} from "../api";
import {
  conditionForApi,
  configScheduleSearch,
  modelSlug,
  parseDimensionScheduleQuery,
  parseScheduleQuery,
  parseVehicleYear,
  resolveModel,
  type ScheduleQueryState,
} from "../data/schema";
import { MaintenanceResults } from "../components/MaintenanceResults";
import { ModelGrid } from "../components/ModelGrid";
import { PrintSheet } from "../components/PrintSheet";
import { SourceBadge } from "../components/SourceBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { VehicleDetailsForm } from "../components/VehicleDetailsForm";
import { YearSelector } from "../components/YearSelector";
import type { ShellOutletContext } from "./shellContext";

interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const pending = <T,>(): RequestState<T> => ({ data: null, loading: true, error: null });
const message = (error: unknown): string => error instanceof Error ? error.message : "Request failed.";
const equal = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? "").localeCompare(right ?? "", undefined, { sensitivity: "accent" }) === 0;

function RouteProblem({ message: detail, backTo = "/cockpit", backLabel = "Back to vehicle selection" }: {
  message: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className="route-problem">
      <ErrorState message={detail} />
      <Link className="btn btn-secondary" to={backTo}>{backLabel}</Link>
    </div>
  );
}

export function NotFoundPage() {
  return <RouteProblem message="This cockpit address does not exist." />;
}

export function CockpitPage() {
  const [state, setState] = useState<RequestState<number[]>>(pending);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState(pending());
    fetchYears()
      .then((years) => { if (active) setState({ data: years, loading: false, error: null }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: message(error) }); });
    return () => { active = false; };
  }, [attempt]);

  if (state.loading) return <LoadingState label="Loading model years…" />;
  if (state.error) return <ErrorState message={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!state.data?.length) return <EmptyState title="No model years available" hint="Check that the local lookup API is running." />;
  return <YearSelector years={state.data} />;
}

export function ModelsPage() {
  const { year: rawYear } = useParams();
  const parsedYear = parseVehicleYear(rawYear);
  const [state, setState] = useState<RequestState<string[]>>(pending);
  const [attempt, setAttempt] = useState(0);
  const year = parsedYear.ok ? parsedYear.value : null;

  useEffect(() => {
    if (year === null) { setState({ data: null, loading: false, error: null }); return; }
    let active = true;
    setState(pending());
    fetchModels(year)
      .then((models) => { if (active) setState({ data: models, loading: false, error: null }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: message(error) }); });
    return () => { active = false; };
  }, [year, attempt]);

  if (!parsedYear.ok) return <RouteProblem message={parsedYear.error} />;
  if (state.loading) return <LoadingState label={`Loading ${parsedYear.value} models…`} />;
  if (state.error) return <ErrorState message={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!state.data?.length) return <RouteProblem message={`No imported Toyota models are available for ${parsedYear.value}.`} />;
  return <ModelGrid year={parsedYear.value} models={state.data} />;
}

interface VehiclePageData {
  model: string;
  options: OptionsResponse;
}

function assertExactConfiguration(config: ConfigRecord, body: LookupBody): void {
  const mismatches = [
    ["trim", config.trim, body.trim],
    ["engine", config.engine, body.engine],
    ["engine size", config.engine_size, body.engineSize],
    ["transmission", config.transmission, body.transmission],
    ["drivetrain", config.drivetrain, body.drivetrain],
    ["condition", config.driving_condition, body.drivingCondition],
  ].filter(([, actual, expected]) => !equal(actual, expected));
  if (mismatches.length > 0) {
    throw new Error(`The imported configuration did not preserve: ${mismatches.map(([label]) => label).join(", ")}.`);
  }
}

async function resolveOnlyConfiguration(body: LookupBody): Promise<ConfigRecord> {
  const response = await fetchConfigs({
    year: body.year,
    model: body.model,
    trim: body.trim,
    engine: body.engine,
    engineSize: body.engineSize,
    transmission: body.transmission,
    drivetrain: body.drivetrain,
    drivingCondition: body.drivingCondition,
  });
  if (response.truncated || response.count !== 1 || response.configs.length !== 1) {
    throw new Error(response.count === 0
      ? "No imported configuration exactly matches these selections."
      : `These selections match ${response.count.toLocaleString("en-US")} configurations. Refine the vehicle details before continuing.`);
  }
  const config = response.configs[0];
  assertExactConfiguration(config, body);
  return config;
}

export function VehiclePage() {
  const { year: rawYear, modelSlug: rawSlug = "" } = useParams();
  const parsedYear = parseVehicleYear(rawYear);
  const year = parsedYear.ok ? parsedYear.value : null;
  const navigate = useNavigate();
  const [state, setState] = useState<RequestState<VehiclePageData>>(pending);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (year === null) { setState({ data: null, loading: false, error: null }); return; }
    let active = true;
    setState(pending());
    fetchModels(year)
      .then(async (models) => {
        const resolved = resolveModel(models, rawSlug);
        if (!resolved.ok) throw new Error(resolved.error);
        return { model: resolved.value, options: await fetchOptions({ year, model: resolved.value }) };
      })
      .then((data) => { if (active) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: message(error) }); });
    return () => { active = false; };
  }, [year, rawSlug, attempt]);

  if (!parsedYear.ok) return <RouteProblem message={parsedYear.error} />;
  if (state.loading) return <LoadingState label="Loading vehicle configurations…" />;
  if (state.error) {
    return state.error.includes("not available") || state.error.includes("address")
      ? <RouteProblem message={state.error} backTo={`/cockpit/${parsedYear.value}`} backLabel={`Back to ${parsedYear.value} models`} />
      : <ErrorState message={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  }
  if (!state.data) return <RouteProblem message="This vehicle could not be loaded." />;

  const submit = async (body: LookupBody) => {
    const config = await resolveOnlyConfiguration(body);
    const condition = body.drivingCondition?.toLowerCase();
    if (condition !== "normal" && condition !== "severe") throw new Error("A valid driving condition is required.");
    const search = configScheduleSearch({
      condition,
      mileage: body.currentMileage,
      ...(body.avgMonthlyMileage === undefined ? {} : { avgMonthlyMileage: body.avgMonthlyMileage }),
      view: "grid",
    });
    navigate(`/schedule/${body.year}/${modelSlug(body.model)}/${encodeURIComponent(config.config_key)}?${search}`);
  };

  return (
    <VehicleDetailsForm
      year={parsedYear.value}
      model={state.data.model}
      options={state.data.options}
      onSubmit={submit}
      backTo={`/cockpit/${parsedYear.value}`}
    />
  );
}

interface ScheduleIdentity {
  year: number;
  modelSlug: string;
  config: ConfigRecord;
  query: ScheduleQueryState;
  body: LookupBody;
  configId: string | null;
}

interface ScheduleData extends ScheduleIdentity {
  result: LookupResult;
  grid: GridResponse;
}

function configBody(config: ConfigRecord, query: ScheduleQueryState): LookupBody {
  return {
    year: config.year,
    model: config.model,
    ...(config.trim ? { trim: config.trim } : {}),
    ...(config.engine ? { engine: config.engine } : {}),
    ...(config.engine_size ? { engineSize: config.engine_size } : {}),
    ...(config.drivetrain ? { drivetrain: config.drivetrain } : {}),
    ...(config.transmission ? { transmission: config.transmission } : {}),
    drivingCondition: conditionForApi(query.condition),
    currentMileage: query.mileage,
    ...(query.avgMonthlyMileage === undefined ? {} : { avgMonthlyMileage: query.avgMonthlyMileage }),
  };
}

async function loadScheduleIdentity(
  rawYear: string | undefined,
  rawSlug: string,
  configId: string | null,
  rawSearch: string,
): Promise<ScheduleIdentity> {
  const parsedYear = parseVehicleYear(rawYear);
  if (!parsedYear.ok) throw new Error(parsedYear.error);
  const search = new URLSearchParams(rawSearch);

  if (configId) {
    const query = parseScheduleQuery(search);
    if (!query.ok) throw new Error(query.error);
    const config = await fetchConfig(configId);
    if (config.config_key !== configId) throw new Error("The configuration response did not match this schedule address.");
    if (config.year !== parsedYear.value || modelSlug(config.model) !== rawSlug) {
      throw new Error("This configuration does not belong to the requested year and model.");
    }
    if (!equal(config.driving_condition, conditionForApi(query.value.condition))) {
      throw new Error("The driving condition does not match this imported configuration.");
    }
    return {
      year: parsedYear.value,
      modelSlug: rawSlug,
      config,
      query: query.value,
      body: configBody(config, query.value),
      configId,
    };
  }

  const query = parseDimensionScheduleQuery(search);
  if (!query.ok) throw new Error(query.error);
  const models = await fetchModels(parsedYear.value);
  const resolvedModel = resolveModel(models, rawSlug);
  if (!resolvedModel.ok) throw new Error(resolvedModel.error);
  const body: LookupBody = {
    year: parsedYear.value,
    model: resolvedModel.value,
    trim: query.value.trim,
    engine: query.value.engine,
    engineSize: query.value.engineSize,
    transmission: query.value.transmission,
    drivetrain: query.value.drivetrain,
    drivingCondition: conditionForApi(query.value.condition),
    currentMileage: query.value.mileage,
    ...(query.value.avgMonthlyMileage === undefined ? {} : { avgMonthlyMileage: query.value.avgMonthlyMileage }),
  };
  const config = await resolveOnlyConfiguration(body);
  return {
    year: parsedYear.value,
    modelSlug: rawSlug,
    config,
    query: query.value,
    body,
    configId: null,
  };
}

function useScheduleData(configIdOverride?: string | null) {
  const { year, modelSlug: rawSlug = "", configId: routeConfigId } = useParams();
  const location = useLocation();
  const configId = configIdOverride === undefined ? (routeConfigId ?? null) : configIdOverride;
  const identitySearch = useMemo(() => {
    const search = new URLSearchParams(location.search);
    for (const key of ["view", "task", "include", "configId"]) search.delete(key);
    return search.toString();
  }, [location.search]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RequestState<ScheduleData>>(pending);

  useEffect(() => {
    let active = true;
    setState(pending());
    loadScheduleIdentity(year, rawSlug, configId, identitySearch)
      .then(async (identity) => {
        const [result, grid] = await Promise.all([
          postLookup(identity.body),
          fetchGrid(identity.body, { range: "full" }),
        ]);
        if (result.source.config_key !== identity.config.config_key || grid.source.config_key !== identity.config.config_key) {
          throw new Error("The lookup did not preserve the exact imported configuration. Choose the vehicle again.");
        }
        if (result.resolution.relaxed_fields.length > 0 || result.resolution.matched_configs !== 1) {
          throw new Error("The lookup was not an exact one-configuration match. Choose the vehicle again.");
        }
        return { ...identity, result, grid };
      })
      .then((data) => { if (active) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (active) setState({ data: null, loading: false, error: message(error) }); });
    return () => { active = false; };
  }, [year, rawSlug, configId, identitySearch, attempt]);

  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

const defaultPrintTasks = (result: LookupResult): string[] => [
  ...new Set(
    [...result.due_now, ...result.overdue]
      .filter((task) => task.customer_visible !== 0)
      .map((task) => task.task_name),
  ),
];

export function SchedulePage() {
  const state = useScheduleData();
  const { setHeaderPresentation } = useOutletContext<ShellOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [includedTaskNames, setIncludedTaskNames] = useState<string[]>([]);
  const presentationQuery = parseScheduleQuery(searchParams);

  useEffect(() => {
    if (!state.data) return;
    const requested = searchParams.getAll("include");
    const visible = new Set(state.data.grid.rows.filter((row) => row.customer_visible !== 0).map((row) => row.taskName));
    setIncludedTaskNames(requested.length > 0
      ? [...new Set(requested.filter((name) => visible.has(name)))]
      : defaultPrintTasks(state.data.result));
  }, [state.data?.result.source.config_key]);

  const printTo = useMemo(() => {
    if (!state.data) return "/cockpit";
    const search = new URLSearchParams(searchParams);
    search.delete("include");
    if (state.data.configId) search.set("configId", state.data.configId);
    for (const name of includedTaskNames) search.append("include", name);
    return `/schedule/${state.data.year}/${state.data.modelSlug}/print?${search.toString()}`;
  }, [state.data, searchParams, includedTaskNames]);

  useEffect(() => {
    if (!state.data) return;
    setHeaderPresentation({ source: state.data.result.source, printTo, printCount: includedTaskNames.length });
    return () => setHeaderPresentation(null);
  }, [state.data, printTo, includedTaskNames.length, setHeaderPresentation]);

  const updateQuery = useCallback((key: "view" | "task", value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  if (!presentationQuery.ok) return <RouteProblem message={presentationQuery.error} />;
  if (state.loading) return <LoadingState label="Loading the exact factory schedule…" />;
  if (state.error) return (
    <div className="route-problem">
      <ErrorState message={state.error} onRetry={state.retry} />
      <Link className="btn btn-secondary" to="/cockpit">Back to vehicle selection</Link>
    </div>
  );
  if (!state.data) return <RouteProblem message="The schedule could not be loaded." />;

  const selectedView = presentationQuery.value.view;
  const togglePrintTask = (taskName: string) => {
    setIncludedTaskNames((current) => current.includes(taskName)
      ? current.filter((name) => name !== taskName)
      : [...current, taskName]);
  };

  return (
    <MaintenanceResults
      result={state.data.result}
      grid={state.data.grid}
      body={state.data.body}
      view={selectedView}
      onViewChange={(view) => updateQuery("view", view)}
      selectedTaskName={searchParams.get("task")}
      onSelectedTaskChange={(taskName) => updateQuery("task", taskName)}
      includedTaskNames={includedTaskNames}
      onTogglePrintTask={togglePrintTask}
      changeVehicleTo={`/vehicle/${state.data.year}/${state.data.modelSlug}`}
    />
  );
}

export function PrintPreviewPage() {
  const [searchParams] = useSearchParams();
  const configId = searchParams.get("configId");
  const state = useScheduleData(configId);
  const presentationQuery = parseScheduleQuery(searchParams);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [state.loading, state.error]);

  if (!presentationQuery.ok) return <main ref={mainRef} className="print-preview" tabIndex={-1}><RouteProblem message={presentationQuery.error} /></main>;
  if (state.loading) return <main ref={mainRef} className="print-preview" tabIndex={-1}><LoadingState label="Preparing printable schedule…" /></main>;
  if (state.error) return <main ref={mainRef} className="print-preview" tabIndex={-1}><RouteProblem message={state.error} /></main>;
  if (!state.data) return <main ref={mainRef} className="print-preview" tabIndex={-1}><RouteProblem message="The print preview could not be loaded." /></main>;

  const backSearch = new URLSearchParams(searchParams);
  backSearch.delete("configId");
  backSearch.delete("include");
  const backPath = state.data.configId
    ? `/schedule/${state.data.year}/${state.data.modelSlug}/${encodeURIComponent(state.data.configId)}`
    : `/schedule/${state.data.year}/${state.data.modelSlug}`;
  const included = searchParams.getAll("include");

  return (
    <main ref={mainRef} className="print-preview" tabIndex={-1}>
      <div className="print-preview-toolbar no-print">
        <Link className="btn btn-secondary" to={`${backPath}?${backSearch.toString()}`}>
          <ArrowLeft size={19} aria-hidden="true" /> Back to schedule
        </Link>
        <SourceBadge source={state.data.result.source} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={19} aria-hidden="true" /> Print customer sheet
        </button>
      </div>
      <PrintSheet
        result={state.data.result}
        grid={state.data.grid}
        includedTaskNames={included.length > 0 ? included : undefined}
        preview
      />
    </main>
  );
}
