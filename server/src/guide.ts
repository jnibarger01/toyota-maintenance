/**
 * Advisor guide generation from a LookupResult.
 *
 * Wording contract:
 *  - Toyota task names always stay visible; advisor_label is appended, never substituted.
 *  - "required" language is used ONLY when a task's priority actually says so;
 *    everything else is "listed on the factory schedule" / "recommended".
 *  - Severe-condition items are labeled explicitly; no exaggeration, no urgency theater.
 *  - Customer-facing sections use plain language; op codes / labor hours / prices
 *    appear only in the internal section. No raw JSON anywhere.
 */
import type { TaskIntervalRow } from "./queries.js";
import type { LookupResult, ConditionDelta } from "./maintenance.js";
import { advisorRank } from "./grid.js";

export interface GuideItem {
  label: string;      // "Toyota task name — ADVISOR LABEL" when mapped
  tags: string[];     // e.g. ["recommended", "Severe-condition"]
}

export interface GuideSection {
  id: string;
  title: string;
  internal?: true;
  paragraphs: string[];
  items?: GuideItem[];
}

export interface AdvisorGuide {
  sections: GuideSection[];
}

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

const isRequired = (t: TaskIntervalRow): boolean => /required/i.test(t.priority ?? "");
const isVisible = (t: TaskIntervalRow): boolean => t.customer_visible !== 0;

function itemLabel(t: TaskIntervalRow): string {
  return t.advisor_label ? `${t.task_name} — ${t.advisor_label}` : t.task_name;
}

function itemTags(t: TaskIntervalRow, severeOnly: Set<string>): string[] {
  const tags: string[] = [];
  if (isRequired(t)) tags.push("required");
  else if (/recommended/i.test(t.priority ?? "")) tags.push("recommended");
  if (t.menu === "Severe") tags.push(severeOnly.has(t.task_name) ? "Severe-condition only" : "Severe-condition");
  return tags;
}

/** Plain-language summary phrases in classic advisor order. */
function summaryPhrases(tasks: TaskIntervalRow[]): string[] {
  const buckets: Array<[number, string]> = [
    [1, "oil and filter service"],
    [2, "tire rotation"],
    [3, "cabin air filter replacement"],
    [4, "engine air filter replacement"],
    [5, "brake inspection"],
    [6, "fluid level checks"],
  ];
  const ranks = new Set(tasks.map((t) => advisorRank(t.task_name, t.category)));
  const phrases = buckets.filter(([r]) => ranks.has(r)).map(([, p]) => p);
  const covered = buckets.filter(([r]) => ranks.has(r)).length;
  const leftovers = tasks.length - tasks.filter((t) => {
    const r = advisorRank(t.task_name, t.category);
    return buckets.some(([b]) => b === r);
  }).length;
  if (leftovers > 0) phrases.push(covered > 0 ? "factory inspections" : `${leftovers} scheduled items`);
  return phrases;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function generateAdvisorGuide(result: LookupResult, delta: ConditionDelta | null = null): AdvisorGuide {
  const v = result.vehicle;
  const m = result.mileage;
  const severeOnly = new Set(delta && v.driving_condition === "Severe" ? delta.only_in_current : []);
  const visibleDue = result.due_now.filter(isVisible);
  const hiddenDue = result.due_now.filter((t) => !isVisible(t));
  const requiredCount = visibleDue.filter(isRequired).length;

  // 1. Vehicle summary --------------------------------------------------------
  const vehicleSummary: GuideSection = {
    id: "vehicle_summary",
    title: "Vehicle summary",
    paragraphs: [
      `${v.year} ${v.make} ${v.model}${v.trim ? " " + v.trim : ""} · ${v.engine ?? "—"} · ${v.drivetrain ?? "—"} · ${v.transmission ?? "—"} — ${v.driving_condition} driving schedule.`,
      `Odometer reading: ${fmt(m.current)} miles.` +
        (m.current_interval !== null
          ? ` The most recent factory interval is the ${fmt(m.current_interval)}-mile service.`
          : ` The first factory interval (${fmt(m.next_interval)} miles) has not been reached yet.`),
    ],
  };
  if (result.resolution.relaxed_fields.length > 0) {
    vehicleSummary.paragraphs.push(
      `Closest configuration match was used (the entered ${result.resolution.relaxed_fields.join(", ")} did not match a listed configuration).`,
    );
  }

  // 2. Due now ----------------------------------------------------------------
  const dueParas: string[] = [];
  if (m.current_interval !== null && visibleDue.length > 0) {
    dueParas.push(
      `At ${fmt(m.current_interval)} miles, this schedule shows ${joinNatural(summaryPhrases(visibleDue))}.`,
    );
    dueParas.push(
      requiredCount > 0
        ? `${requiredCount} of ${visibleDue.length} items are listed as required; the rest are recommended by the factory schedule.`
        : `All ${visibleDue.length} items are recommended by the factory maintenance schedule.`,
    );
  } else if (m.current_interval !== null) {
    dueParas.push(`No customer-facing items are listed at the ${fmt(m.current_interval)}-mile interval.`);
  } else {
    dueParas.push(
      `No factory interval has been reached yet. The first scheduled service is at ${fmt(m.next_interval)} miles.`,
    );
  }
  const dueNow: GuideSection = {
    id: "due_now",
    title: "Due now",
    paragraphs: dueParas,
    items: visibleDue.map((t) => ({ label: itemLabel(t), tags: itemTags(t, severeOnly) })),
  };

  // 3. Why it matters ---------------------------------------------------------
  const whyLines: string[] = [];
  const ranks = new Set(visibleDue.map((t) => advisorRank(t.task_name, t.category)));
  if (ranks.has(1)) whyLines.push("Fresh oil and a new filter protect the engine and keep the maintenance record current.");
  if (ranks.has(2)) whyLines.push("Rotating the tires evens out wear, which helps them last longer and ride quieter.");
  if (ranks.has(3) || ranks.has(4)) whyLines.push("Clean filters keep airflow where it should be for the cabin and the engine.");
  if (ranks.has(5)) whyLines.push("A brake inspection measures the parts that wear, before wear becomes a repair.");
  if (ranks.has(6)) whyLines.push("Checking fluid levels catches slow leaks and low levels early.");
  if (ranks.has(8) || visibleDue.length > 0) whyLines.push("The factory inspections exist to catch small issues while they are still small.");
  if (whyLines.length === 0) whyLines.push("Following the published schedule keeps the vehicle's maintenance history complete.");
  const whyItMatters: GuideSection = { id: "why_it_matters", title: "Why it matters", paragraphs: whyLines };

  // 4. Next visit ---------------------------------------------------------------
  const nextParas: string[] = [];
  if (m.next_interval !== null) {
    let line = `The next maintenance point is ${fmt(m.next_interval)} miles`;
    if (result.estimate.months_to_next !== null) {
      line += ` — based on your monthly mileage, that is about ${result.estimate.months_to_next} month${result.estimate.months_to_next === 1 ? "" : "s"} away`;
      if (result.estimate.next_due_date) line += ` (around ${result.estimate.next_due_date})`;
    } else {
      line += ` (${fmt(m.next_interval - m.current)} miles from today's reading)`;
    }
    nextParas.push(line + ".");
  } else {
    nextParas.push(
      "The odometer is past the last published interval on this schedule; your advisor will set the next visit from the vehicle's service history.",
    );
  }
  const nextVisit: GuideSection = { id: "next_visit", title: "Next visit", paragraphs: nextParas };

  // 5. Special driving condition notes ------------------------------------------
  const condParas: string[] = [];
  if (v.driving_condition === "Severe") {
    condParas.push(
      "This is the Severe-condition schedule. It applies when the vehicle regularly tows, carries heavy loads, drives dusty or dirt roads, or makes repeated short trips.",
    );
    if (severeOnly.size > 0) {
      condParas.push(
        `${severeOnly.size} of today's items appear only on the Severe schedule and are labeled "Severe-condition only" above.`,
      );
    }
    if (delta) condParas.push(`For comparison, the Normal schedule lists ${delta.other_count} items at this interval.`);
  } else {
    condParas.push(
      "This lookup uses the Normal driving schedule. Towing, heavy loads, dusty or dirt roads, and repeated short trips fall under Toyota's Severe schedule instead.",
    );
    if (delta && delta.added_in_other.length > 0) {
      condParas.push(
        `At this interval, the Severe schedule adds ${delta.added_in_other.length} item${delta.added_in_other.length === 1 ? "" : "s"} — ask your advisor if any Severe conditions apply to how the vehicle is driven.`,
      );
    }
  }
  const conditionNotes: GuideSection = {
    id: "driving_condition_notes",
    title: "Special driving condition notes",
    paragraphs: condParas,
  };

  // 6. Source / provenance --------------------------------------------------------
  const provenance: GuideSection = {
    id: "source_provenance",
    title: "Source & provenance",
    paragraphs: [
      `Schedule source: ${result.source.source} factory maintenance data${result.source.schedule_name ? ` — ${result.source.schedule_name}` : ""}.`,
      `Configuration key ${result.source.config_key} · content hash ${result.source.schedule_hash}.`,
      "The source data contains no VIN, customer, or pricing information; any prices shown come from the dealership's own service menu.",
    ],
  };

  // 7. Internal advisor notes ------------------------------------------------------
  const internalParas: string[] = [];
  const mapped = visibleDue.filter((t) => t.op_code || t.labor_hours !== null || t.menu_price_cents !== null);
  if (mapped.length > 0) {
    for (const t of mapped) {
      const bits: string[] = [];
      if (t.op_code) bits.push(`op code ${t.op_code}`);
      if (t.labor_hours !== null) bits.push(`${t.labor_hours} hr labor`);
      if (t.menu_price_cents !== null) bits.push(`menu $${(t.menu_price_cents / 100).toFixed(2)}`);
      internalParas.push(`${t.task_name}: ${bits.join(", ")}.`);
    }
  } else {
    internalParas.push("No dealership op-code/labor/price mappings on file for today's items.");
  }
  if (hiddenDue.length > 0) {
    internalParas.push(
      `${hiddenDue.length} scheduled item(s) are marked not customer-visible and were left off the customer sections: ${hiddenDue.map((t) => t.task_name).join("; ")}.`,
    );
  }
  if (result.overdue.length > 0) {
    internalParas.push(
      `Verify the ${fmt(m.previous_interval)}-mile items against service history before presenting (${result.overdue.length} item(s) flagged by the ${fmt(m.overdue_threshold_miles)}-mile overdue threshold).`,
    );
  }
  if (result.resolution.relaxed_fields.length > 0) {
    internalParas.push(
      `Config resolution relaxed: ${result.resolution.relaxed_fields.join(", ")} (matched ${result.resolution.matched_configs} configurations; schedule content verified by hash).`,
    );
  }
  const internalNotes: GuideSection = {
    id: "internal_advisor_notes",
    title: "Internal advisor notes",
    internal: true,
    paragraphs: internalParas,
  };

  return {
    sections: [vehicleSummary, dueNow, whyItMatters, nextVisit, conditionNotes, provenance, internalNotes],
  };
}
