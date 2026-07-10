import type { GuideResponse } from "../api";
import { EmptyState } from "./States";

/** Customer guide. Internal sections are rejected defensively even if an older API returns one. */
export function MaintenanceGuide({ guide }: { guide: GuideResponse }) {
  const sections = guide.guide.sections.filter((section) => !section.internal);
  if (sections.length === 0) {
    return <EmptyState title="No public guide content available" hint="The factory schedule grid is still available." />;
  }
  return (
    <div className="guide">
      {sections.map((s) => (
        <section key={s.id} className="guide-section">
          <h3 className="section-header section-header-sub">
            {s.title}
          </h3>
          {s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          {s.items && s.items.length > 0 ? (
            <ul className="task-list">
              {s.items.map((i) => (
                <li key={i.label} className="task-line">
                  <span className="task-name">{i.label}</span>
                  {i.tags.map((t) => (
                    <span key={t} className={t.startsWith("Severe") ? "tag tag-severe" : "tag"}>{t}</span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
