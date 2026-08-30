import { describe, expect, it } from "vitest";

import { dump } from "./dump.js";
import { inspectSnapshotMigration, migrateSnapshot } from "./migrate.js";
import { restore } from "./restore.js";
import { run } from "./run.js";
import { EXECUTION_SEMANTICS } from "./snapshot/dump-format.js";

const compoundOperators = [
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>="
];
const assignmentOperators = ["=", ...compoundOperators, "&&=", "||=", "??="];
const NativeAsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

describe("assignment reference evaluation", () => {
  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    -(Number.MAX_SAFE_INTEGER + 1),
    1e100,
    -1e100,
    Number.MAX_VALUE / 4,
    -0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])("preserves numeric operand %s through host replay and migration inspection", async (input) => {
    const source = "let value = await load(); value *= 3; effect(value); return value;";
    let reads = 0;
    const effects: number[] = [];
    const bindings = {
      load: async () => {
        reads += 1;
        return input;
      },
      effect: (value: number) => {
        effects.push(value);
      }
    };
    const original = await run(source, { bindings });
    expect(original.returnValue).toBe(input * 3);
    const snapshot = JSON.parse(await dump(original));
    expect(inspectSnapshotMigration(snapshot, { source }).unresolvedCalls).toEqual([]);
    const result = await run(source, { snapshot: restore(snapshot, { source }), bindings });
    expect(result.returnValue).toBe(input * 3);
    expect(reads).toBe(1);
    expect(effects).toEqual([input * 3]);
    expect(() =>
      restore({ ...snapshot, clock: { next: Number.MAX_SAFE_INTEGER + 1 } }, { source })
    ).toThrow();
  });

  it.each(compoundOperators)("reads the member before the RHS for %s", async (operator) => {
    for (const shape of ["{ value: 12 }", "[12]"]) {
      const key = shape.startsWith("[") ? "0" : '"value"';
      const source = `
        const original = ${shape};
        let target = original;
        const trace = [];
        function base() { trace.push("base"); return target; }
        function key() { trace.push("key"); return ${key}; }
        function right() {
          trace.push("right");
          original[${key}] = 96;
          target = ${shape};
          return 2;
        }
        const assigned = base()[key()] ${operator} right();
        return [assigned, original[${key}], target[${key}], trace];
      `;
      const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  });

  it.each(assignmentOperators)("orders constant assignment failures for %s", async (operator) => {
    for (const initial of ["0", "1", "null", "undefined"]) {
      const source = `
        const trace = [];
        const value = ${initial};
        function right() { trace.push("right"); return 2; }
        try { trace.push(value ${operator} right()); }
        catch (error) { trace.push(error.name); }
        return [trace, value];
      `;
      const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  });

  it.each(["let", "const"])(
    "checks the %s temporal dead zone at the right operation",
    async (kind) => {
      for (const operator of assignmentOperators) {
        const source = `
        const trace = [];
        function right() { trace.push("right"); return 2; }
        try {
          value ${operator} right();
          ${kind} value = 1;
        } catch (error) { trace.push(error.name); }
        return trace;
      `;
        const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
        await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
      }
    }
  );

  it.each(assignmentOperators)("orders unresolved writes for %s", async (operator) => {
    const source = `
      const trace = [];
      function right() { trace.push("right"); return 2; }
      try { missing ${operator} right(); }
      catch (error) { trace.push(error.name); }
      return trace;
    `;
    const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("keeps a member's original value across an awaited RHS and completed replay", async () => {
    const source = `
      const target = { value: 12 };
      async function right() {
        target.value = 96;
        return await read();
      }
      const result = target.value += await right();
      return [result, target.value];
    `;
    let reads = 0;
    const bindings = {
      read: async () => {
        reads += 1;
        return 2;
      }
    };
    const expected = await new NativeAsyncFunction("read", `"use strict"; ${source}`)(
      async () => 2
    );
    const original = await run(source, { bindings });
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    let snapshot = JSON.parse(await dump(original));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await run(source, {
        bindings,
        snapshot: restore(JSON.parse(JSON.stringify(snapshot)), { source })
      });
      expect(result).toMatchObject({ ok: true, returnValue: expected });
      snapshot = JSON.parse(await dump(result));
    }
    expect(reads).toBe(1);
  });

  it("preserves existing own-property flags when assigning arguments.length", async () => {
    const source = `
      function inspect(first, second) {
        arguments.length = 1;
        return [arguments.length, Object.keys(arguments)];
      }
      return inspect(10, 20);
    `;
    const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["=", "+=", "&&="])(
    "reads restricted arguments accessors only when required for %s",
    async (operator) => {
      const source = `
      const trace = [];
      function inspect() {
        function right() { trace.push("right"); return 2; }
        try { arguments.callee ${operator} right(); }
        catch (error) { trace.push(error.name); }
      }
      inspect();
      return trace;
    `;
      const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("uses the captured RegExp.lastIndex for compound writes and updates", async () => {
    const source = `
      const expression = /text/g;
      expression.lastIndex = 12;
      const assigned = expression.lastIndex += (expression.lastIndex = 2);
      const previous = expression.lastIndex++;
      return [assigned, previous, expression.lastIndex];
    `;
    const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(assignmentOperators)("orders primitive property writes for %s", async (operator) => {
    for (const target of ['"text"', "42", "true"]) {
      for (const key of ['"length"', '"missing"']) {
        const source = `
          const trace = [];
          const target = ${target};
          function right() { trace.push("right"); return 2; }
          try { trace.push(target[${key}] ${operator} right()); }
          catch (error) { trace.push(error.name); }
          return trace;
        `;
        const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
        await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
      }
    }
  });

  it.each(compoundOperators)("coerces captured operands after the RHS for %s", async (operator) => {
    const source = `
      const trace = [];
      const original = { valueOf() { trace.push("left"); return 12; } };
      const target = { value: original };
      function right() {
        trace.push("right");
        target.value = 96;
        return { valueOf() { trace.push("operand"); return 2; } };
      }
      const result = target.value ${operator} right();
      return [result, target.value, trace];
    `;
    const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "++value",
    "value++",
    "--value",
    "value--",
    "++target.value",
    "target.value++",
    "--target.value",
    "target.value--"
  ])("coerces the captured value before writing %s", async (expression) => {
    for (const kind of ["let", "const"]) {
      const source = `
          const trace = [];
          ${kind} value = { valueOf() { trace.push("coerce"); return 12; } };
          const target = { value };
          try { trace.push(${expression}); }
          catch (error) { trace.push(error.name); }
          return trace;
        `;
      const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
      await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
    }
  });

  it("does not fall back after both coercion methods return objects", async () => {
    const source = `
      const trace = [];
      let value = {
        valueOf() { trace.push("valueOf"); return {}; },
        toString() { trace.push("toString"); return {}; }
      };
      try { value += 1; } catch (error) { trace.push(error.name); }
      return trace;
    `;
    const expected = await new NativeAsyncFunction(`"use strict"; ${source}`)();
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });

  it("requires explicit migration instead of replaying earlier reference semantics", async () => {
    const source =
      "const target = { value: 1 }; target.value += (target.value = 4); return target.value;";
    const original = await run(source);
    const snapshot = JSON.parse(await dump(original));
    expect(snapshot.executionSemantics).toBe(EXECUTION_SEMANTICS);
    const previous = { ...snapshot, executionSemantics: "jobs-v5" };
    expect(() => restore(previous, { source })).toThrow("incompatible execution semantics");
    const targetSource = "return import.meta.migration.result;";
    for (const predecessor of [previous, snapshot]) {
      const inspection = inspectSnapshotMigration(predecessor, { source });
      const migrated = migrateSnapshot(predecessor, {
        source,
        targetSource,
        state: { result: 5 },
        reconciliation: {
          checkpointDigest: inspection.checkpointDigest,
          quiescent: true,
          calls: []
        }
      });
      expect(migrated.executionSemantics).toBe(EXECUTION_SEMANTICS);
      await expect(run(targetSource, { snapshot: migrated })).resolves.toMatchObject({
        ok: true,
        returnValue: 5
      });
    }
  });
});
