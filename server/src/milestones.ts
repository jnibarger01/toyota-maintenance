/**
 * Milestone math. Pure functions over a sorted mileage grid — no I/O.
 *
 * Advisor conventions encoded here:
 *  - snap(): current odometer snaps to the NEAREST grid milestone; exact ties
 *    round UP (at 72,500 on a 5k grid you sell the 75k service, not the 70k).
 *  - next(): first grid milestone strictly greater than the cycle-adjusted mileage.
 *  - Beyond grid max the Toyota pattern repeats: cycle_mileage = odo % grid_max
 *    (0 maps to grid_max). Results are flagged `extrapolated: true` so the UI
 *    and print sheet can disclose it.
 */

export interface MilestoneContext {
  entered: number;          // odometer as entered
  cycleMileage: number;     // odometer mapped into the grid cycle
  extrapolated: boolean;    // true when entered > grid max
  snapped: number;          // nearest grid milestone (ties up)
  next: number;             // first milestone strictly after cycleMileage (wraps)
  nextWraps: boolean;       // true when `next` is grid[0] of the following cycle
  milesToNext: number;      // distance from entered odometer to the next milestone occurrence
  gridMin: number;
  gridMax: number;
  step: number;
}

export function assertGrid(grid: number[]): void {
  if (grid.length === 0) throw new Error("empty grid");
  for (let i = 1; i < grid.length; i++) {
    if (grid[i] <= grid[i - 1]) throw new Error("grid must be strictly ascending");
  }
  if (grid[0] <= 0) throw new Error("grid must be positive");
}

/** Map an odometer reading into the repeating cycle [1 .. gridMax]. */
export function cycleMileage(entered: number, gridMax: number): { value: number; extrapolated: boolean } {
  if (entered <= gridMax) return { value: entered, extrapolated: false };
  const r = entered % gridMax;
  return { value: r === 0 ? gridMax : r, extrapolated: true };
}

/** Nearest grid milestone to m; exact midpoint ties round UP. */
export function snapToGrid(m: number, grid: number[]): number {
  assertGrid(grid);
  let best = grid[0];
  let bestDist = Math.abs(m - best);
  for (const g of grid) {
    const d = Math.abs(m - g);
    if (d < bestDist || (d === bestDist && g > best)) { best = g; bestDist = d; }
  }
  return best;
}

/** First grid milestone strictly greater than m; wraps to grid[0] past the end. */
export function nextMilestone(m: number, grid: number[]): { milestone: number; wraps: boolean } {
  assertGrid(grid);
  for (const g of grid) if (g > m) return { milestone: g, wraps: false };
  return { milestone: grid[0], wraps: true };
}

export function buildContext(entered: number, grid: number[], step: number): MilestoneContext {
  assertGrid(grid);
  const gridMax = grid[grid.length - 1];
  const cyc = cycleMileage(entered, gridMax);
  const snapped = snapToGrid(cyc.value, grid);
  const nx = nextMilestone(cyc.value, grid);
  // Distance to the next occurrence on the real odometer:
  const milesToNext = nx.wraps
    ? gridMax - cyc.value + nx.milestone
    : nx.milestone - cyc.value;
  return {
    entered,
    cycleMileage: cyc.value,
    extrapolated: cyc.extrapolated,
    snapped,
    next: nx.milestone,
    nextWraps: nx.wraps,
    milesToNext,
    gridMin: grid[0],
    gridMax,
    step,
  };
}

/** Estimated months until the next milestone, given average monthly miles. */
export function monthsToNext(milesToNext: number, monthlyMiles: number | null | undefined): number | null {
  if (!monthlyMiles || monthlyMiles <= 0) return null;
  return Math.max(0, Math.ceil(milesToNext / monthlyMiles));
}

/** Nearby milestones around the snapped point: up to `before` earlier and `after` later grid points. */
export function nearbyMilestones(snapped: number, grid: number[], before = 2, after = 2): number[] {
  const i = grid.indexOf(snapped);
  if (i === -1) throw new Error(`snapped milestone ${snapped} not on grid`);
  return grid.slice(Math.max(0, i - before), Math.min(grid.length, i + after + 1));
}
