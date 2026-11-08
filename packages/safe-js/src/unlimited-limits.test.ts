import { expect, it } from "vitest";
import { assertSandboxGraphDepth, assertSnapshotGraphDepth } from "./graph-depth.js";
import { parseModule } from "./parse/parser.js";
import { Budget } from "./interp/budget.js";
import { validateRuntimeSnapshotDescriptors, validateSnapshotData } from "./snapshot/validation.js";
import { createRealm, defineExtension, run } from "./core.js";

it("accepts graph and descriptor depths beyond the former default", () => {
  let value: object = {};
  for (let i = 0; i < 1100; i++) value = { value };
  expect(() => assertSandboxGraphDepth(value)).not.toThrow();
  expect(() => assertSnapshotGraphDepth(value)).not.toThrow();
  expect(() => validateRuntimeSnapshotDescriptors(value)).not.toThrow();
  expect(() => assertSandboxGraphDepth(value, 10)).toThrow(expect.objectContaining({ budget: "dataDepth", limit: 10 }));
  expect(() => assertSnapshotGraphDepth(value, "$", 10)).toThrow(expect.objectContaining({ budget: "dataDepth", limit: 10 }));
  expect(() => validateRuntimeSnapshotDescriptors(value, new Budget({ maxCallDepth: 10 }))).toThrow("nesting limit 10");
});

it("accepts parser nesting beyond former ceilings", () => {
  expect(() => parseModule("return " + "true ? 1 : ".repeat(300) + "0")).not.toThrow();
  expect(() => parseModule("if(false) 1; else ".repeat(2100) + "0;")).not.toThrow();
});

it.each([undefined, Infinity, 70000])("accepts host capability maxima %s", async maximum => {
  const realm = createRealm({ budget: new Budget(), extensions: [defineExtension({ manifest: { version: 1, name: "large", globals: ["large"] }, setup(context) {
    return { globals: { large: context.createHostObject({
      indexed: { length: () => 70000, get: () => 1, ...(maximum === undefined ? {} : { maxLength: maximum }) },
      named: { keys: () => [], get: () => 1, ...(maximum === undefined ? {} : { maxKeys: maximum, maxKeyCodeUnits: maximum === Infinity ? Infinity : 2000000 }) }
    }) } };
  } })] });
  try { expect(await realm.evaluate("return large.length")).toMatchObject({ returnValue: 70000 }); }
  finally { await realm.close(); }
});

it("enforces explicitly configured parser nesting budgets", () => {
  const budget = new Budget({ maxCallDepth: 10 });
  const lease = budget.acquireCompileOwner();
  try {
    expect(() => parseModule("return " + "true ? 1 : ".repeat(20) + "0", "conditional.js", lease.owner))
      .toThrow("Conditional expression nesting limit exceeded");
    expect(() => parseModule("if(false) 1; else ".repeat(20) + "0;", "if.js", lease.owner))
      .toThrow("If statement nesting limit exceeded");
  } finally { lease.release(); }
});

it("validates deep snapshot data without host recursion and rejects wire cycles", () => {
  let value: object = {};
  for (let i = 0; i < 20000; i++) value = { value };
  expect(() => validateSnapshotData(value)).not.toThrow();
  const cyclic: { self?: object } = {};
  cyclic.self = cyclic;
  expect(() => validateSnapshotData(cyclic)).toThrow(expect.objectContaining({ code: "invalidCycle" }));
});

it.each([{}, { maxKeys: undefined, maxKeyCodeUnits: undefined }, { maxKeys: Infinity, maxKeyCodeUnits: Infinity }])(
  "defaults guest expando limits to Infinity: %j", async expandos => {
    const realm = createRealm({ extensions: [defineExtension({
      manifest: { version: 1, name: "expandos", globals: ["record"] },
      setup(context) { return { globals: { record: context.createHostObject({ expandos }) } }; }
    })] });
    try { expect(await realm.evaluate("record.value = 1; return record.value")).toMatchObject({ returnValue: 1 }); }
    finally { await realm.close(); }
  }
);

it.each([false, true])("counts ternaries nested in tests (binary wrapper: %s)", wrapped => {
  const budget = new Budget({ maxCallDepth: 4 });
  const lease = budget.acquireCompileOwner();
  let expression = "true";
  try {
    for (let depth = 1; depth <= 10; depth++) {
      expression = `(${wrapped ? `true && ${expression}` : expression} ? true : false)`;
      const parse = () => parseModule(`return ${expression};`, "left-conditional.js", lease.owner);
      if (depth <= 4) {
        expect(parse).not.toThrow();
        const nested = () => parseModule(`return true ? ${expression} : false;`, "mixed.js", lease.owner);
        if (depth < 4) expect(nested).not.toThrow();
        else expect(nested).toThrow("Conditional expression nesting limit exceeded");
      } else expect(parse).toThrow("Conditional expression nesting limit exceeded");
    }
    expect(() => parseModule("return (((true && true))) ? true : false;", "plain.js", lease.owner)).not.toThrow();
    expect(() => parseModule(`return true ? ${expression} : false;`, "mixed.js", lease.owner))
      .toThrow("Conditional expression nesting limit exceeded");
  } finally { lease.release(); }
});

it("rejects left-nested ternaries through the public run API", async () => {
  let expression = "true";
  for (let depth = 0; depth < 10; depth++) expression = `(${expression} ? true : false)`;
  await expect(run(`return ${expression};`, { budget: new Budget({ maxCallDepth: 4 }) }))
    .rejects.toThrow("Conditional expression nesting limit exceeded");
  expect(await run("return (((true && true))) ? true : false;", { budget: new Budget({ maxCallDepth: 1 }) }))
    .toMatchObject({ ok: true, returnValue: true });
});
