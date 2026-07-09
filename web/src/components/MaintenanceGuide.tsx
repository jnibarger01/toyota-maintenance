import type { GuideResponse } from "../api";

/** Guide tab — the seven-section advisor guide; internal section clearly flagged. */
export function MaintenanceGuide({ guide }: { guide: GuideResponse }) {
  return (
    <div className="guide">
      {guide.guide.sections.map((s) => (
        <section key={s.id} className={s.internal ? "guide-section guide-internal" : "guide-section"}>
          <h3 className="section-header section-header-sub">
            {s.title}
            {s.internal ? <span className="tag tag-internal">Internal — not printed</span> : null}
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
