import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Circle, LocateFixed, Minus } from "lucide-react";
import type { GridResponse, GridRow } from "../api";
import { EmptyState } from "./States";

interface MaintenanceGridProps {
  grid: GridResponse;
  selectedTaskName: string | null;
  onSelectTask: (row: GridRow) => void;
}

/** Customer-safe service items × mileage intervals, grouped by source category. */
export function MaintenanceGrid({ grid, selectedTaskName, onSelectTask }: MaintenanceGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const headers = useRef(new Map<number, HTMLTableCellElement>());
  const scrollArea = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => grid.rows.filter((row) => row.customer_visible !== 0),
    [grid.rows],
  );
  const groups = useMemo(() => {
    const grouped: Array<{ category: string; rows: GridRow[] }> = [];
    for (const row of rows) {
      const existing = grouped.find((group) => group.category === row.category);
      if (existing) existing.rows.push(row);
      else grouped.push({ category: row.category, rows: [row] });
    }
    return grouped;
  }, [rows]);
  const publishedMileages = useMemo(
    () => grid.columns
      .filter((column) => rows.some((row) => row.cells[String(column.mileage)]))
      .map((column) => column.mileage),
    [grid.columns, rows],
  );
  const currentMileage = grid.mileage.current_interval;
  const nextMileage = grid.mileage.next_interval ?? grid.columns.find((column) => column.next)?.mileage ?? null;
  const previousMileage = currentMileage === null
    ? null
    : (publishedMileages.filter((mileage) => mileage < currentMileage).at(-1) ?? null);

  const centerInterval = (mileage: number, behavior: ScrollBehavior) => {
    const container = scrollArea.current;
    const header = headers.current.get(mileage);
    if (!container || !header) return;
    const stickyWidth = container.querySelector<HTMLTableCellElement>("th.mx-grid-service")?.offsetWidth ?? 0;
    const visibleDataWidth = Math.max(0, container.clientWidth - stickyWidth);
    const visibleCenter = stickyWidth + visibleDataWidth / 2;
    const containerRect = container.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const headerCenter = headerRect.left - containerRect.left + container.scrollLeft + headerRect.width / 2;
    const left = Math.max(0, headerCenter - visibleCenter);
    if (behavior === "auto") {
      const previous = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      container.scrollLeft = left;
      container.style.scrollBehavior = previous;
    } else {
      container.scrollTo?.({ left, behavior });
    }
  };

  useEffect(() => {
    const target = currentMileage ?? nextMileage;
    if (target === null) return;
    const frame = requestAnimationFrame(() => {
      centerInterval(target, "auto");
    });
    return () => cancelAnimationFrame(frame);
  }, [currentMileage, nextMileage]);

  if (grid.columns.length === 0) {
    return <EmptyState title="No published intervals for this schedule" hint="This factory schedule does not contain a mileage grid." />;
  }
  if (rows.length === 0) {
    return <EmptyState title="No customer-facing schedule items" hint="No public maintenance items are listed in this interval window." />;
  }

  const toggleCategory = (category: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };
  const jumpTo = (mileage: number | null) => {
    if (mileage === null) return;
    centerInterval(mileage, "smooth");
  };

  return (
    <div className="timeline">
      <div className="timeline-controls" aria-label="Mileage timeline controls">
        <button type="button" className="timeline-jump" disabled={previousMileage === null} onClick={() => jumpTo(previousMileage)}>
          <ChevronLeft size={16} aria-hidden="true" /> Previous interval
        </button>
        <button type="button" className="timeline-jump" disabled={currentMileage === null} onClick={() => jumpTo(currentMileage)}>
          <LocateFixed size={16} aria-hidden="true" /> Current interval
        </button>
        <button type="button" className="timeline-jump" disabled={nextMileage === null} onClick={() => jumpTo(nextMileage)}>
          Next interval <ChevronRight size={16} aria-hidden="true" />
        </button>
        <span className="timeline-range">0–{grid.columns.at(-1)?.label ?? "0"} mi</span>
      </div>
      <div ref={scrollArea} className="grid-scroll" role="region" aria-label="Factory maintenance mileage grid" tabIndex={0}>
        <table className="mx-grid">
        <caption className="sr-only">
          Toyota factory maintenance tasks by mileage interval. A marker means the task is listed at that interval.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="mx-grid-service">Factory task</th>
            {grid.columns.map((column) => (
              <th
                key={column.mileage}
                ref={(element) => {
                  if (element) headers.current.set(column.mileage, element);
                  else headers.current.delete(column.mileage);
                }}
                scope="col"
                className={["mx-col", column.current ? "current" : "", column.next ? "next" : ""].filter(Boolean).join(" ")}
              >
                <span>{column.label} mi</span>
                {column.current ? <span className="current-tag">Current interval</span> : null}
                {!column.current && column.next ? <span className="next-tag">Next interval</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => {
            const isCollapsed = collapsed.has(group.category);
            return (
              <tbody key={group.category} className="mx-category-group">
                <tr className="mx-cat-row">
                  <th scope="rowgroup" className="mx-grid-service mx-cat-label">
                    <button
                      type="button"
                      className="category-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleCategory(group.category)}
                    >
                      {isCollapsed
                        ? <ChevronRight size={18} aria-hidden="true" />
                        : <ChevronDown size={18} aria-hidden="true" />}
                      <span>{group.category}</span>
                      <span className="category-count">{group.rows.length}</span>
                    </button>
                  </th>
                  <td className="mx-cat-fill" colSpan={grid.columns.length} aria-hidden="true" />
                </tr>
                {!isCollapsed ? group.rows.map((row) => {
                  const selected = selectedTaskName === row.taskName;
                  return (
                    <tr key={row.taskName} className={selected ? "mx-task-row selected" : "mx-task-row"}>
                      <th scope="row" className="mx-grid-service">
                        <button
                          type="button"
                          className="task-select"
                          aria-pressed={selected}
                          onClick={() => onSelectTask(row)}
                        >
                          <span className="task-source-name">{row.taskName}</span>
                          {row.advisor_label ? <span className="advisor-label">Service label: {row.advisor_label}</span> : null}
                        </button>
                      </th>
                      {grid.columns.map((column) => {
                        const scheduled = Boolean(row.cells[String(column.mileage)]);
                        const className = ["mx-cell", column.current ? "current" : "", column.next ? "next" : "", selected ? "selected" : ""]
                          .filter(Boolean).join(" ");
                        return (
                          <td key={column.mileage} className={className}>
                            {scheduled ? (
                              <button
                                type="button"
                                className="mx-marker"
                                aria-label={`${row.taskName}, scheduled at ${column.label} miles`}
                                onClick={() => onSelectTask(row)}
                              >
                                <Circle size={14} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="mx-empty">
                                <Minus size={15} aria-hidden="true" />
                                <span className="sr-only">Not scheduled at {column.label} miles</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }) : null}
              </tbody>
            );
        })}
        </table>
      </div>
    </div>
  );
}
