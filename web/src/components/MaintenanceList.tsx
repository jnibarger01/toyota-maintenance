import type { LookupResult, LookupTask } from "../api";
import { EmptyState } from "./States";

function TaskLine({ t }: { t: LookupTask }) {
  return (
    <li className="task-line">
      <span className="task-name">{t.task_name}</span>
      {t.advisor_label ? <span className="task-raw">Service label: {t.advisor_label}</span> : null}
      {t.menu === "Severe" ? <span className="tag tag-severe">Severe-condition</span> : null}
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

/** List tab — current interval / history check / upcoming from the lookup result. */
export function MaintenanceList({ result }: { result: LookupResult }) {
  const m = result.mileage;
  const visible = (tasks: LookupTask[]) => tasks.filter((t) => t.customer_visible !== 0);
  const dueNow = visible(result.due_now);
  const overdue = visible(result.overdue);
  const upcoming = visible(result.upcoming);
  if (result.intervals.length === 0) {
    return <EmptyState title="No published intervals for this schedule" />;
  }
  if (m.current_interval !== null && dueNow.length === 0 && overdue.length === 0 && upcoming.length === 0) {
    return <EmptyState title="No customer-facing items in this interval window" />;
  }
  return (
    <div>
      {m.current_interval === null ? (
        <EmptyState
          title="First factory interval not reached yet"
          hint={`First scheduled service is at ${m.next_interval?.toLocaleString("en-US")} miles.`}
        />
      ) : null}
      <Group title="At current interval" kind="due" miles={m.current_interval} tasks={dueNow} />
      <Group title="Verify from previous visit" kind="overdue" miles={m.previous_interval} tasks={overdue} />
      <Group title="Upcoming" kind="upcoming" miles={m.next_interval} tasks={upcoming} />
    </div>
  );
}
