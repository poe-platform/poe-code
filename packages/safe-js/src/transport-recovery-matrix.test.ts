import { describe, expect, it, vi } from "vitest";
import { Temporal } from "temporal-polyfill/full/implementation";
import { createRealm } from "./realm.js";
import { dump } from "./dump.js";
import { run } from "./run.js";
import { inspectSnapshotMigration, migrateSnapshot } from "./migrate.js";

// These are data projections, not claims that native prototypes cross the boundary.
const categories = [
  ...(["Map", "Set", "Number"] as const).map((kind) => ({
    name: `${kind} symbol descriptors`,
    make: () => {
      const key = Symbol("key");
      const value = kind === "Map" ? new Map([[1, 2]]) : kind === "Set" ? new Set([1]) : Object(7);
      Object.defineProperties(value, { key: { value: key }, self: { value } });
      Object.defineProperty(value, key, { value });
      Object.freeze(value);
      return value;
    },
    check:
      "value.self===value && value[value.key]===value && Object.isFrozen(value) && !Object.getOwnPropertyDescriptor(value,'self').enumerable"
  })),
  {
    name: "symbol-keyed object graph",
    make: () => {
      const key = Symbol("key");
      const value = { key, [key]: null as unknown };
      value[key] = value;
      return value;
    },
    check: "Object.getOwnPropertySymbols(value).length===1 && value[value.key]===value"
  },
  {
    name: "symbol-keyed array graph",
    make: () => {
      const key = Symbol("key");
      const value = Object.assign([key], { [key]: null as unknown });
      value[key] = value;
      return value;
    },
    check: "Object.getOwnPropertySymbols(value).length===1 && value[value[0]]===value"
  },
  {
    name: "symbol value aliases",
    make: () => {
      const key = Symbol("key");
      return [key, key];
    },
    check: "typeof value[0]==='symbol' && value[0]===value[1]"
  },
  {
    name: "boxed Number descriptors",
    make: () => {
      const value = Object(7);
      Object.defineProperty(value, "self", { value });
      Object.freeze(value);
      return value;
    },
    check:
      "value.valueOf()===7 && value.self===value && Object.isFrozen(value) && !Object.getOwnPropertyDescriptor(value,'self').enumerable"
  },
  {
    name: "special primitives",
    make: () => [undefined, null, true, "text", -0, NaN, Infinity, 7n],
    check:
      "value[0]===undefined && value[1]===null && value[2] && value[3]==='text' && Object.is(value[4],-0) && Number.isNaN(value[5]) && value[6]===Infinity && value[7]===7n"
  },
  {
    name: "cyclic aliased graph",
    make: () => {
      const child = { n: 7 };
      const value: Record<string, unknown> = { a: child, b: child };
      value.self = value;
      return value;
    },
    check: "value.a===value.b && value.self===value && value.a.n===7"
  },
  {
    name: "sparse array",
    make: () => {
      const value = new Array(3);
      value[1] = 7;
      return value;
    },
    check: "value.length===3 && !(0 in value) && value[1]===7 && !(2 in value)"
  },
  {
    name: "null prototype",
    make: () => Object.assign(Object.create(null), { n: 7 }),
    check: "Object.getPrototypeOf(value)===null && value.n===7"
  },
  {
    name: "Map cycle",
    make: () => {
      const value = new Map();
      value.set(value, value);
      return value;
    },
    check: "value instanceof Map && value.get(value)===value"
  },
  {
    name: "Set cycle",
    make: () => {
      const value = new Set();
      value.add(value);
      return value;
    },
    check: "value instanceof Set && value.has(value)"
  },
  { name: "Date", make: () => new Date(0), check: "value instanceof Date && value.getTime()===0" },
  {
    name: "RegExp cursor",
    make: () => {
      const value = /x/g;
      value.lastIndex = 2;
      return value;
    },
    check:
      "value instanceof RegExp && value.source==='x' && value.flags==='g' && value.lastIndex===2"
  },
  {
    name: "ArrayBuffer alias",
    make: () => {
      const buffer = new ArrayBuffer(4);
      return { buffer, view: new Uint8Array(buffer) };
    },
    check: "value.buffer===value.view.buffer && value.buffer.byteLength===4"
  },
  {
    name: "DataView",
    make: () => {
      const value = new DataView(new ArrayBuffer(4));
      value.setInt16(0, 257);
      return value;
    },
    check: "value instanceof DataView && value.getInt16(0)===257"
  },
  {
    name: "BigInt typed array",
    make: () => new BigInt64Array([7n]),
    check: "value instanceof BigInt64Array && value[0]===7n"
  },
  {
    name: "Temporal.Instant",
    make: () => new Temporal.Instant(7n),
    check: "value instanceof Temporal.Instant && value.epochNanoseconds===7n"
  },
  {
    name: "Temporal.Duration",
    make: () => new Temporal.Duration(0, 0, 0, 2),
    check: "value instanceof Temporal.Duration && value.days===2"
  },
  {
    name: "Temporal.PlainDate",
    make: () => new Temporal.PlainDate(2000, 2, 29),
    check: "value instanceof Temporal.PlainDate && value.day===29"
  },
  {
    name: "Temporal.PlainTime",
    make: () => new Temporal.PlainTime(12, 34),
    check: "value instanceof Temporal.PlainTime && value.minute===34"
  },
  {
    name: "Temporal.PlainDateTime",
    make: () => new Temporal.PlainDateTime(2000, 2, 29, 12),
    check: "value instanceof Temporal.PlainDateTime && value.hour===12 && value.day===29"
  },
  {
    name: "Temporal.PlainMonthDay",
    make: () => new Temporal.PlainMonthDay(2, 29),
    check: "value instanceof Temporal.PlainMonthDay && value.day===29"
  },
  {
    name: "Temporal.PlainYearMonth",
    make: () => new Temporal.PlainYearMonth(2000, 2),
    check: "value instanceof Temporal.PlainYearMonth && value.month===2"
  },
  {
    name: "Temporal.ZonedDateTime",
    make: () => new Temporal.ZonedDateTime(0n, "UTC"),
    check: "value instanceof Temporal.ZonedDateTime && value.epochNanoseconds===0n"
  }
];

describe.each(["bindings", "modules", "returns", "callback", "realm", "migration"] as const)(
  "transport matrix: %s",
  (path) => {
    it.each(categories)("preserves $name", async ({ make, check }) => {
      const value = make();
      const read = vi.fn(() => value);
      const invoke = vi.fn(async (callback: (input: unknown) => unknown) => callback(value));
      if (path === "realm") {
        const realm = createRealm({ bindings: { value } });
        try {
          expect(await realm.evaluate("const retained=value;")).toMatchObject({ ok: true });
          expect(await realm.evaluate(`return retained===value && (${check});`)).toMatchObject({
            ok: true,
            returnValue: true
          });
        } finally {
          await realm.close();
        }
        return;
      }
      if (path === "migration") {
        const source = "return 0;";
        const snapshot = JSON.parse(await dump(await run(source)));
        const targetSource = `const value=import.meta.migration; return ${check};`;
        const migrated = migrateSnapshot(snapshot, {
          source,
          targetSource,
          state: value,
          reconciliation: {
            checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
            quiescent: true,
            calls: []
          }
        });
        expect(await run(targetSource, { snapshot: migrated })).toMatchObject({
          ok: true,
          returnValue: true
        });
        return;
      }
      const options =
        path === "modules"
          ? { modules: { host: { value } } }
          : path === "returns"
            ? { bindings: { read } }
            : path === "callback"
              ? { bindings: { invoke } }
              : { bindings: { value } };
      const source =
        path === "modules"
          ? `import { value } from "host"; return ${check};`
          : path === "returns"
            ? `const value=read(); return ${check};`
            : path === "callback"
              ? `return await invoke(value=>${check});`
              : `return ${check};`;
      const first = await run(source, options);
      expect(first).toMatchObject({ ok: true, returnValue: true });
      const snapshot = JSON.parse(await dump(first));
      expect(await run(source, { ...options, snapshot })).toMatchObject({
        ok: true,
        returnValue: true
      });
      if (path === "returns") expect(read).toHaveBeenCalledOnce();
      if (path === "callback") expect(invoke).toHaveBeenCalledOnce();
    });
  }
);
