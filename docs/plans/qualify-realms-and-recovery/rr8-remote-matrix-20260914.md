# Clean-main transport matrix observation — 2026-09-14

This is reproducible manual QA of the unfinished qualification. Do not count the
observed failures as passes or relax these assertions. The ECMAScript/extension
pins in the evidence ledger remain unchanged. Jobs-v9 admission is a separate
candidate-format expectation, not an ECMAScript requirement.

1. Use the source and environment recorded in [the repair report](rr8-repair-20260914.md).
   Build the selected SafeJS workspace using its maintained build closure.
2. In an isolated checkout, create the three files named below from their fenced
   contents. These are the inherited qualification assertions with only import
   paths relocated; no assertion, runtime, timeout or budget is changed.
3. Run `CI=1 npx vitest run tests/integration/rr8-remote-transport --reporter=json --outputFile=matrix-results.json`.
4. Inspect every failed row. Delete only these temporary observation copies when
   finished; preserve original source and pre-existing tests.

Clean remote main `e5b836a93d4bbb259b3cf57ae8781757f202fe0f` plus the RR-8 repair,
Node22.23.2/ICU78.2, observed **215 passes / 59 failures / zero skips**:

| Matrix                | Pass | Fail | Disposition                                                                            |
| --------------------- | ---: | ---: | -------------------------------------------------------------------------------------- |
| Supported transport   |  118 |   38 | Inherited metadata/projection repairs not delivered by RR-8                            |
| Unsupported rejection |   81 |   19 | Map/Set subclasses and opaque Proxies still admitted; revoked Proxy diagnostics differ |
| Version envelope      |   16 |    2 | Both jobs-v9 envelopes remain unsupported by remote jobs-v8                            |

The original dirty jobs-v9 candidate passed all 274 cells. That result does not
qualify the clean delivered runtime. This nonpass remains an explicit blocker.

## tests/integration/rr8-remote-transport-recovery-matrix.test.ts

Source SHA-256: `533aebc68847364a945b545ff0e704e224469d5708059a84ab145b5e238a44ba`.

```ts
import { describe, expect, it, vi } from "vitest";
import { Temporal } from "temporal-polyfill/full/implementation";
import { createRealm } from "../../packages/safe-js/src/realm.js";
import { dump } from "../../packages/safe-js/src/dump.js";
import { run } from "../../packages/safe-js/src/run.js";
import { inspectSnapshotMigration, migrateSnapshot } from "../../packages/safe-js/src/migrate.js";

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
```

## tests/integration/rr8-remote-transport-rejection-matrix.test.ts

Source SHA-256: `cae3726bc0112b378bb337b19dba39d7b409d830da01970139c66f83b3488c6c`.

```ts
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createRealm } from "../../packages/safe-js/src/realm.js";
import { run } from "../../packages/safe-js/src/run.js";
import { deepCopyToSandbox } from "../../packages/safe-js/src/interp/values.js";

const unsupported = [
  { name: "foreign Map", make: () => runInNewContext("new Map()") },
  { name: "foreign Set", make: () => runInNewContext("new Set()") },
  {
    name: "Map subclass",
    make: () => new (class extends Map {})(),
    error: "Map subclasses are not supported"
  },
  {
    name: "Set subclass",
    make: () => new (class extends Set {})(),
    error: "Set subclasses are not supported"
  },
  {
    name: "Date subclass",
    make: () => new (class extends Date {})(),
    error: "Date subclasses are not supported"
  },
  {
    name: "foreign Date",
    make: () => runInNewContext("new Date()"),
    error: "Date subclasses are not supported"
  },
  { name: "opaque Proxy", make: () => new Proxy({}, {}), error: "Unsupported proxy sandbox value" },
  {
    name: "revoked Proxy",
    make: () => {
      const pair = Proxy.revocable({}, {});
      pair.revoke();
      return pair.proxy;
    },
    error: "Unsupported proxy sandbox value"
  },
  { name: "class instance", make: () => new (class Unsupported {})() },
  { name: "foreign class instance", make: () => runInNewContext("new (class Unsupported {})()") },
  { name: "WeakMap", make: () => new WeakMap() },
  { name: "WeakSet", make: () => new WeakSet() },
  { name: "WeakRef", make: () => new WeakRef({}) },
  { name: "FinalizationRegistry", make: () => new FinalizationRegistry(() => {}) },
  { name: "native array iterator", make: () => [1].values() },
  { name: "native Map iterator", make: () => new Map([[1, 2]]).values() },
  { name: "native Set iterator", make: () => new Set([1]).values() },
  {
    name: "native generator",
    make: () =>
      (function* () {
        yield 1;
      })()
  },
  {
    name: "native async generator",
    make: () =>
      (async function* () {
        yield 1;
      })()
  },
  { name: "native Intl formatter", make: () => new Intl.NumberFormat("en-US") }
];

describe.each(["copy", "bindings", "modules", "returns", "realm"] as const)(
  "unsupported transport: %s",
  (path) => {
    it.each(unsupported)("rejects $name", async (category) => {
      const { make } = category;
      const error = "error" in category ? category.error : "Unsupported sandbox value";
      const value = make();
      if (path === "copy") {
        expect(() => deepCopyToSandbox(value)).toThrow(TypeError);
        return;
      }
      if (path === "realm") {
        const realm = createRealm({ bindings: { value } });
        try {
          await expect(realm.evaluate("return value;")).rejects.toThrow(error);
        } finally {
          await realm.close();
        }
        return;
      }
      const options =
        path === "modules"
          ? { modules: { host: { value } } }
          : path === "returns"
            ? { bindings: { read: () => value } }
            : { bindings: { value } };
      const source =
        path === "modules"
          ? 'import { value } from "host"; return value;'
          : path === "returns"
            ? "return read();"
            : "return value;";
      await expect(run(source, options)).rejects.toThrow(error);
    });
  }
);
```

## tests/integration/rr8-remote-transport-version-matrix.test.ts

Source SHA-256: `bd49dc71275d873de0823c07fc249764d54e32beb08fb867ec37e6c0ee6b89b1`.

```ts
import { expect, it } from "vitest";
import { run } from "../../packages/safe-js/src/run.js";
import { dump } from "../../packages/safe-js/src/dump.js";
import { restore } from "../../packages/safe-js/src/restore.js";
import { inspectSnapshotMigration, migrateSnapshot } from "../../packages/safe-js/src/migrate.js";

// Synthetic envelope controls complement the unchanged genuine jobs-v6 fixtures.
it.each(
  [1, 2].flatMap((version) =>
    Array.from({ length: 9 }, (_, index) => ({ version, executionSemantics: `jobs-v${index + 1}` }))
  )
)("qualifies format $version with $executionSemantics", async ({ version, executionSemantics }) => {
  const source = "return 1;";
  const snapshot = JSON.parse(await dump(await run(source)));
  snapshot.version = version;
  snapshot.executionSemantics = executionSemantics;
  if (version === 1) {
    snapshot.bindings = {};
    delete snapshot.heap;
  }
  const bytes = JSON.stringify(snapshot);
  if (["jobs-v6", "jobs-v7", "jobs-v8", "jobs-v9"].includes(executionSemantics))
    expect(() => restore(snapshot, { source })).not.toThrow();
  else expect(() => restore(snapshot, { source })).toThrow("incompatible execution semantics");
  const targetSource = "return import.meta.migration;";
  const migrated = migrateSnapshot(snapshot, {
    source,
    targetSource,
    state: 7,
    reconciliation: {
      checkpointDigest: inspectSnapshotMigration(snapshot, { source }).checkpointDigest,
      quiescent: true,
      calls: []
    }
  });
  expect(await run(targetSource, { snapshot: migrated })).toMatchObject({
    ok: true,
    returnValue: 7
  });
  expect(JSON.stringify(snapshot)).toBe(bytes);
});
```
