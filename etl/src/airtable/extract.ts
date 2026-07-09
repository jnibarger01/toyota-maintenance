/** schedule_key / config_key extraction with the spec's precedence. */
import type { AirtableRecord } from "./client.js";

const KEY_FIELDS = ["schedule_key", "config_key", "Schedule Key", "Config Key"];
const HEX40 = /\b[0-9a-f]{40}\b/;
const LABELED = /(?:schedule|config)[ _]?key\s*[:=]\s*([0-9a-f]{40})/i;

export interface ExtractedKey { key: string | null; via: "field" | "description" | null }

export function extractScheduleKey(record: AirtableRecord): ExtractedKey {
  // 1) explicit field first
  for (const f of KEY_FIELDS) {
    const v = record.fields[f];
    if (typeof v === "string") {
      const m = v.trim().toLowerCase().match(HEX40);
      if (m) return { key: m[0], via: "field" };
    }
  }
  // 2) otherwise parse from Description (labeled line preferred, then any 40-hex token)
  const desc = record.fields["Description"] ?? record.fields["description"];
  if (typeof desc === "string") {
    const labeled = desc.match(LABELED);
    if (labeled) return { key: labeled[1].toLowerCase(), via: "description" };
    const any = desc.toLowerCase().match(HEX40);
    if (any) return { key: any[0], via: "description" };
  }
  return { key: null, via: null };
}

export function descriptionOf(record: AirtableRecord): string | null {
  const d = record.fields["Description"] ?? record.fields["description"];
  return typeof d === "string" ? d : null;
}
