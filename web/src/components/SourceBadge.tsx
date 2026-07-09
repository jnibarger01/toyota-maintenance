import type { Source } from "../api";

/** Compact provenance pill: source system + short schedule reference. */
export function SourceBadge({ source }: { source: Source }) {
  const shortRef = `${source.config_key.slice(0, 10)}…`;
  return (
    <span
      className="source-badge"
      title={`${source.source} · config ${source.config_key} · schedule ${source.schedule_hash}`}
    >
      <span className="source-badge-system">{source.source}</span>
      <span className="source-badge-ref">{shortRef}</span>
    </span>
  );
}
