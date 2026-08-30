import { describe, expect, it } from "vitest";

import { HostCallJournal, type HostCallOutcome } from "./host-call.js";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

describe.each(["fulfilled", "rejected"] as const)("%s host outcome graph", (status) => {
  it.each(["object-first", "collection-first"])(
    "retains aliases and cycles through copies and serialized replay (%s)",
    (order) => {
      const journal = new HostCallJournal("graph-source");
      const input = {
        moduleId: "host",
        operation: "callback",
        argumentDigest: "args",
        policy: "read-side-effect" as const
      };
      const record = journal.issue(input).record;
      const compute = createSandboxClosure({ call: () => 7, length: 1 });
      journal.registerCallbackFunction(record, 1, compute, async () => undefined);
      const shared: SandboxObject = { compute, alias: compute };
      shared.self = shared;
      const map = createSandboxMap();
      const set = createSandboxSet();
      const rows = Object.assign(new Array<SandboxValue>(5), {
        metadata: shared,
        raw: shared,
        map: 0
      });
      rows[1] = undefined;
      rows[3] = shared;
      rows[4] = rows;
      const graph =
        order === "object-first"
          ? { shared, alias: shared, rows, map, set }
          : { map, set, rows, shared, alias: shared };
      map.entries.set(compute, shared);
      map.entries.set(shared, rows);
      map.entries.set(map, graph);
      set.values.add(compute);
      set.values.add(shared);
      set.values.add(set);
      shared.map = map;
      shared.set = set;
      journal.settle(
        record,
        status === "fulfilled" ? { status, value: graph } : { status, reason: graph }
      );

      const check = (outcome: HostCallOutcome | undefined) => {
        expect(outcome?.status).toBe(status);
        if (outcome === undefined) throw new Error("Missing host outcome");
        const copied = (
          outcome.status === "fulfilled" ? outcome.value : outcome.reason
        ) as typeof graph;
        expect(copied).not.toBe(graph);
        expect(copied.shared).not.toBe(shared);
        expect(copied.map).not.toBe(map);
        expect(copied.set).not.toBe(set);
        expect(copied.alias).toBe(copied.shared);
        expect(copied.shared.self).toBe(copied.shared);
        expect(copied.shared.compute).toBe(compute);
        expect(copied.shared.alias).toBe(compute);
        expect(copied.shared.map).toBe(copied.map);
        expect(copied.shared.set).toBe(copied.set);
        expect(copied.map.entries.get(compute)).toBe(copied.shared);
        expect(copied.map.entries.get(copied.shared)).toBe(copied.rows);
        expect(copied.map.entries.get(copied.map)).toBe(copied);
        expect(copied.set.values.has(compute)).toBe(true);
        expect(copied.set.values.has(copied.shared)).toBe(true);
        expect(copied.set.values.has(copied.set)).toBe(true);
        expect(copied.rows.length).toBe(5);
        expect(Object.keys(copied.rows)).toEqual(["1", "3", "4", "metadata", "raw", "map"]);
        expect(Object.hasOwn(copied.rows, 0)).toBe(false);
        expect(Object.hasOwn(copied.rows, 1)).toBe(true);
        expect(copied.rows[1]).toBeUndefined();
        expect(copied.rows[3]).toBe(copied.shared);
        expect(copied.rows[4]).toBe(copied.rows);
        expect(copied.rows.metadata).toBe(copied.shared);
        expect(copied.rows.raw).toBe(copied.shared);
        expect(copied.rows.map).toBe(0);
        return copied;
      };

      check(record.outcome);
      const snapshot = journal.snapshot();
      const copied = check(snapshot[0]?.outcome);
      copied.map.entries.clear();
      copied.set.values.clear();
      check(journal.snapshot()[0]?.outcome);
      const retained = new HostCallJournal("graph-source", journal.snapshot());
      check(retained.snapshot()[0]?.outcome);
      const restored = new HostCallJournal(
        "graph-source",
        [],
        undefined,
        JSON.parse(JSON.stringify(journal.snapshotReplay()))
      );
      const replayRecord = restored.issue(input).record;
      restored.registerCallbackFunction(replayRecord, 1, compute, async () => undefined);
      check(restored.replayOutcome(replayRecord));
      map.entries.clear();
      set.values.clear();
      check(journal.snapshot()[0]?.outcome);
    }
  );
});
