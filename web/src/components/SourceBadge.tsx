import type { Source } from "../api";
import { Database } from "lucide-react";

/** Customer-safe provenance badge: factual source plus a short schedule reference. */
export function SourceBadge({ source }: { source: Source }) {
  const shortRef = `${source.config_key.slice(0, 10)} / ${source.schedule_hash.slice(0, 10)}`;
  return (
    <span
      className="source-badge"
      title={`Factory schedule reference ${shortRef}`}
    >
      <Database size={18} strokeWidth={2} aria-hidden="true" />
      <span className="source-badge-copy">
        <span className="source-badge-label">Factory schedule</span>
        <span className="source-badge-system">Source: {source.source}</span>
      </span>
    </span>
  );
}
