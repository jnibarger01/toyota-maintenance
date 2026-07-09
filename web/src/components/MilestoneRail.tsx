/**
 * Signature element: horizontal service-interval rail.
 * Every grid milestone is a tick; the odometer triangle sits at cycle position,
 * the DUE milestone is the red node, the NEXT milestone the amber node.
 */
import { fmtMiles } from "../api";

interface Props {
  grid: number[];
  snapped: number | null;
  next: number | null;
  cycleMileage: number | null;
  entered: number;
  extrapolated: boolean;
}

const W = 1000;
const H = 104;
const PAD = 34;
const BASE_Y = 58;

function kLabel(m: number): string {
  return m % 1000 === 0 ? `${m / 1000}K` : String(m);
}

export function MilestoneRail({ grid, snapped, next, cycleMileage, entered, extrapolated }: Props) {
  if (grid.length === 0) return null;
  const min = grid[0];
  const max = grid[grid.length - 1];
  const span = Math.max(max - min, 1);
  const x = (m: number) => PAD + ((m - min) / span) * (W - 2 * PAD);

  // Label every other tick to keep the scale readable at 24 points,
  // but always label the due and next milestones.
  const labeled = new Set<number>();
  grid.forEach((m, i) => {
    if (i % 2 === 0) labeled.add(m);
  });
  if (snapped !== null) labeled.add(snapped);
  if (next !== null) labeled.add(next);

  const odoX = cycleMileage !== null ? x(Math.min(Math.max(cycleMileage, min), max)) : null;

  return (
    <div className="rail-svg-card">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Service interval rail">
        {/* baseline */}
        <line x1={PAD} y1={BASE_Y} x2={W - PAD} y2={BASE_Y} stroke="#3d4552" strokeWidth={2} />

        {/* ticks + labels */}
        {grid.map((m) => {
          const isDue = m === snapped;
          const isNext = m === next && !isDue;
          return (
            <g key={m}>
              <line
                x1={x(m)}
                y1={BASE_Y - (isDue || isNext ? 10 : 6)}
                x2={x(m)}
                y2={BASE_Y + (isDue || isNext ? 10 : 6)}
                stroke={isDue ? "#eb0a1e" : isNext ? "#c77800" : "#9aa3ad"}
                strokeWidth={isDue || isNext ? 2.4 : 1.4}
              />
              {labeled.has(m) && (
                <text
                  x={x(m)}
                  y={BASE_Y + 26}
                  textAnchor="middle"
                  fontFamily="'Saira Extra Condensed','Arial Narrow',sans-serif"
                  fontWeight={isDue || isNext ? 700 : 500}
                  fontSize={isDue || isNext ? 15 : 13}
                  fill={isDue ? "#eb0a1e" : isNext ? "#c77800" : "#3d4552"}
                >
                  {kLabel(m)}
                </text>
              )}
            </g>
          );
        })}

        {/* due node */}
        {snapped !== null && <circle cx={x(snapped)} cy={BASE_Y} r={7.5} fill="#eb0a1e" />}
        {/* next node */}
        {next !== null && next !== snapped && (
          <circle cx={x(next)} cy={BASE_Y} r={6} fill="#fff" stroke="#c77800" strokeWidth={2.6} />
        )}

        {/* odometer marker */}
        {odoX !== null && (
          <g>
            <path
              d={`M ${odoX} ${BASE_Y - 14} l -7 -12 l 14 0 z`}
              fill="#16181d"
            />
            <text
              x={odoX}
              y={BASE_Y - 32}
              textAnchor="middle"
              fontFamily="'Saira Extra Condensed','Arial Narrow',sans-serif"
              fontWeight={700}
              fontSize={17}
              fill="#16181d"
            >
              {fmtMiles(entered)}
              {extrapolated ? " ↺" : ""}
            </text>
          </g>
        )}
      </svg>
      <div className="rail-legend">
        <span><span className="dot" style={{ background: "#eb0a1e" }} />Due milestone</span>
        <span><span className="dot" style={{ background: "#c77800" }} />Next milestone</span>
        <span>▲ Odometer{extrapolated ? " (↺ = position within repeating cycle)" : ""}</span>
      </div>
    </div>
  );
}
