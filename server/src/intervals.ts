/**
 * Interval math for POST /api/maintenance/lookup.
 *
 * This is the FLOOR model over task interval_miles:
 *   current  = greatest interval <= mileage   (the service point just passed / hit)
 *   previous = greatest interval <  current   (candidate "overdue" bucket)
 *   next     = smallest interval >  mileage
 *
 * Deliberately different from milestones.ts (nearest-with-ties-up snapping used
 * by /api/schedules/:key/due). No cycle wrap here: above the final interval,
 * next is null.
 */

export interface IntervalContext {
  current: number | null;
  previous: number | null;
  next: number | null;
}

/** intervals must be sorted ascending and de-duplicated. */
export function intervalContext(mileage: number, intervals: number[]): IntervalContext {
  let current: number | null = null;
  let previous: number | null = null;
  let next: number | null = null;
  for (const m of intervals) {
    if (m <= mileage) {
      previous = current;
      current = m;
    } else {
      next = m;
      break;
    }
  }
  return { current, previous, next };
}

/** Literal spec rule: previous interval's tasks are overdue once mileage exceeds it by threshold. */
export function overdueTriggered(mileage: number, previous: number | null, thresholdMiles: number): boolean {
  return previous !== null && mileage - previous > thresholdMiles;
}

export interface NextEstimate {
  months_to_next: number | null;
  next_due_date: string | null; // ISO yyyy-mm-dd
}

export function estimateNext(
  mileage: number,
  next: number | null,
  avgMonthlyMileage: number | null | undefined,
  now: Date = new Date(),
): NextEstimate {
  if (next === null || avgMonthlyMileage == null || avgMonthlyMileage <= 0) {
    return { months_to_next: null, next_due_date: null };
  }
  const months = Math.max(0, Math.ceil((next - mileage) / avgMonthlyMileage));
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() + months);
  return { months_to_next: months, next_due_date: d.toISOString().slice(0, 10) };
}
