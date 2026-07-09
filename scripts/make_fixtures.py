#!/usr/bin/env python3
"""Extract a self-contained fixture slice (2020 TOYOTA 4RUNNER) from the full JSONL artifacts.

Usage: python3 scripts/make_fixtures.py --src /path/to/full/artifacts --dst fixtures
Keeps every invariant of the full set (schedule -> template hash -> items, tasks, edges, provenance)
so the ETL runs unmodified against the slice.
"""
import argparse, json, os, re

DESC_HASH = re.compile(r"^Schedule Hash:\s*(\S+)", re.M)

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", default="fixtures")
    ap.add_argument("--year", type=int, default=2020)
    ap.add_argument("--model", default="4RUNNER")
    args = ap.parse_args()
    os.makedirs(args.dst, exist_ok=True)

    keys, hashes, task_keys = set(), set(), set()

    with open(os.path.join(args.src, "airtable_schedules_import.jsonl")) as fin, \
         open(os.path.join(args.dst, "airtable_schedules_import.jsonl"), "w") as fout:
        for line in fin:
            o = json.loads(line)
            f = o["fields"]
            if f["Year"] == args.year and f["Model"] == args.model:
                fout.write(line)
                keys.add(o["schedule_key"])
                hashes.add(DESC_HASH.search(f["Description"]).group(1))
                task_keys.update(o.get("task_keys", []))

    with open(os.path.join(args.src, "unique_schedule_templates.jsonl")) as fin, \
         open(os.path.join(args.dst, "unique_schedule_templates.jsonl"), "w") as fout:
        for line in fin:
            if json.loads(line)["Schedule Hash"] in hashes:
                fout.write(line)

    with open(os.path.join(args.src, "airtable_tasks_import.jsonl")) as fin, \
         open(os.path.join(args.dst, "airtable_tasks_import.jsonl"), "w") as fout:
        for line in fin:
            if json.loads(line)["task_key"] in task_keys:
                fout.write(line)

    with open(os.path.join(args.src, "airtable_schedule_task_edges.jsonl")) as fin, \
         open(os.path.join(args.dst, "airtable_schedule_task_edges.jsonl"), "w") as fout:
        for line in fin:
            if json.loads(line)["schedule_key"] in keys:
                fout.write(line)

    with open(os.path.join(args.src, "airtable_schedule_create_success.jsonl")) as fin, \
         open(os.path.join(args.dst, "airtable_schedule_create_success.jsonl"), "w") as fout:
        for line in fin:
            if json.loads(line)["schedule_key"] in keys:
                fout.write(line)

    print(f"fixtures: {len(keys)} schedules, {len(hashes)} templates, {len(task_keys)} tasks -> {args.dst}/")

if __name__ == "__main__":
    main()
