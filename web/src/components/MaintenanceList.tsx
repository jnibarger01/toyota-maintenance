import type { LookupResult, LookupTask } from "../api";
import { dollars } from "../api";
import { EmptyState } from "./States";

function TaskLine({ t }: { t: LookupTask }) {
  return (
    <li className="task-line">
      <span className="task-name">{t.advisor_label ?? t.task_name}</span>
      {t.advisor_label ? <span className="task-raw">{t.task_name}</span> : null}
      {t.menu === "Severe" ? <span className="tag tag-severe">Severe-condition</span> : null}
      {t.menu_price_cents !== null ? <span className="task-price">{dollars(t.menu_price_cents)}</span> : null}
    </li>
  );
}

function Group({ title, kind, miles, tasks }: { title: string; kind: string; miles: number | null; tasks: LookupTask[] }) {
  if (miles === null || tasks.length === 0) return null;
  return (
    <section className={`list-group list-group-${kind}`}>
      <h3 className="section-header section-header-sub">
        {title} · {miles.toLocaleString("en-US")} miles
      </h3>
      <ul className="task-list">{tasks.map((t) => <TaskLine key={t.task_key} t={t} />)}</ul>
    </section>
  );
}

/** List tab — due / overdue / upcoming from the lookup result. */
export function MaintenanceList({ result }: { result: LookupResult }) {
  const m = result.mileage;
  if (result.intervals.length === 0) {
    return <EmptyState title="No published intervals for this schedule" />;
  }
  return (
    <div>
      {m.current_interval === null ? (
        <EmptyState
          title="First factory interval not reached yet"
          hint={`First scheduled service is at ${m.next_interval?.toLocaleString("en-US")} miles.`}
        />
      ) : null}
      <Group title="Due now" kind="due" miles={m.current_interval} tasks={result.due_now} />
      <Group title="Verify from previous visit" kind="overdue" miles={m.previous_interval} tasks={result.overdue} />
      <Group title="Upcoming" kind="upcoming" miles={m.next_interval} tasks={result.upcoming} />
    </div>
  );
}
