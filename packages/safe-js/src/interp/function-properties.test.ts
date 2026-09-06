import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Budget, run } from "../core.js";
import { dump } from "../snapshot/dump.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore as restoreInterpreterSnapshot } from "../snapshot/restore.js";
import { restore as restoreDump } from "../restore.js";
import { encodeReplayData } from "../snapshot/replay-data.js";
import {
  deepCopyFromSandbox,
  deepCopyToSandbox,
  measureSandboxData,
  type SandboxValue
} from "./values.js";
import { markDescriptorObject } from "./object-model.js";

describe("guest function objects through the public core", () => {
  it.each([
    [
      "own properties",
      'function Counter() {} Counter.label = "counter"; return Counter.label;',
      "counter"
    ],
    [
      "constructor prototypes",
      "function Counter() { this.value = 7; } Counter.prototype.read = function() { return this.value; }; return new Counter().read();",
      7
    ],
    ["instanceof", "function Counter() {} return new Counter() instanceof Counter;", true],
    [
      "shared prototype identity",
      "function Counter() {} const prototype = { read() { return this.value; } }; Counter.fn = Counter.prototype = prototype; const instance = new Counter(); instance.value = 9; return Counter.fn === prototype && instance.read() === 9 && instance instanceof Counter;",
      true
    ],
    [
      "prototype constructor identity",
      "function Counter() {} return Counter.prototype.constructor === Counter && new Counter().constructor === Counter;",
      true
    ],
    [
      "enumeration and deletion",
      "function Counter() {} Counter.label = 1; Counter.extra = 2; delete Counter.extra; return Object.keys(Counter).join(',');",
      "label"
    ],
    [
      "arrow properties",
      "const callback = () => 7; callback.label = 'arrow'; return callback.label + ':' + callback();",
      "arrow:7"
    ],
    [
      "bound constructor identity",
      "function Counter(value) { this.value = value; } const Bound = Counter.bind(null, 7); Bound.label = 'bound'; const instance = new Bound(); return instance.value === 7 && instance instanceof Counter && instance instanceof Bound && Bound.label === 'bound';",
      true
    ],
    [
      "data descriptors",
      "function Counter() {} Object.defineProperty(Counter, 'label', { value: 7, enumerable: true }); const descriptor = Object.getOwnPropertyDescriptor(Counter, 'label'); return descriptor.value === 7 && descriptor.enumerable === true && descriptor.writable === false && Object.keys(Counter).join(',') === 'label';",
      true
    ]
  ])("supports %s", async (_name, source, expected) => {
    const result = await run(String(source), { budget: new Budget() });
    expect(result).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not make arrows or methods constructible", async () => {
    const result = await run(
      "const arrow = () => 1; const object = { method() {} }; let denied = 0; try { new arrow(); } catch (error) { denied++; } try { new object.method(); } catch (error) { denied++; } return denied;",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: 2 });
  });

  it("keeps host constructors and internal closure fields inaccessible", async () => {
    const result = await run(
      "function Counter() {} Math.abs.label = 'changed'; return Math.abs.label === 'changed' && Counter.constructor === undefined && Counter.kind === undefined && Counter.properties === undefined && Math.abs.constructor === undefined && Math.abs.kind === undefined && Math.abs.properties === undefined;",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: true });
  });

  it("does not inherit native fields from intrinsic function property tables", async () => {
    const result = await run(
      "return [Array.constructor, Array.__proto__, Number.constructor, String.constructor, Promise.constructor];",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: [undefined, undefined, undefined, undefined, undefined]
    });
  });

  it("preserves inherited non-writable properties", async () => {
    const result = await run(
      "function Counter() {} Object.defineProperty(Counter.prototype, 'value', { value: 7 }); const instance = new Counter(); let denied = false; try { instance.value = 9; } catch (error) { denied = true; } return denied && instance.value === 7 && !Object.hasOwn(instance, 'value');",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: true });
  });

  it("rejects prototype cycles and preserves aliases", async () => {
    const result = await run(
      "function Parent() {} function Child() {} Object.setPrototypeOf(Child.prototype, Parent.prototype); const child = new Child(); let denied = false; try { Object.setPrototypeOf(Parent.prototype, Child.prototype); } catch (error) { denied = true; } return denied && child instanceof Child && child instanceof Parent && Object.getPrototypeOf(Child.prototype) === Parent.prototype;",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: true });
  });

  it("keeps own properties available when invoking a bridged callback", async () => {
    const result = await run(
      "function callback() { return callback.value; } callback.value = 7; return await invoke(callback);",
      {
        budget: new Budget(),
        bindings: { invoke: async (callback: () => Promise<unknown>) => callback() }
      }
    );
    expect(result).toMatchObject({ ok: true, returnValue: 7 });
  });

  it.each([
    "function Counter() {} Counter.value = 7; return 1;",
    "function Counter() {} const instance = new Counter(); return 1;",
    "function Parent() {} function Child() {} Object.setPrototypeOf(Child, Parent); return 1;",
    "Object.setPrototypeOf(Number, { value: 7 }); return 1;",
    "Object.setPrototypeOf(Number, null); return 1;"
  ])("preserves the complete guest heap through public dump and replay: %s", async (source) => {
    const result = await run(source, { budget: new Budget() });
    expect(result).toMatchObject({ ok: true, returnValue: 1 });
    const snapshot = JSON.parse(await dump(result));
    const replayed = await run(source, { snapshot: restoreDump(snapshot, { source }), budget: new Budget() });
    expect(replayed).toMatchObject({ ok: true, returnValue: 1 });
    const recaptured = JSON.parse(await dump(replayed));
    expect(recaptured.heap).toEqual(snapshot.heap);
    expect(recaptured.bindings).toEqual(snapshot.bindings);
  });

  it("rejects data copies that would discard guest prototype identity", async () => {
    const result = await run("function Counter() {} return new Counter();", {
      budget: new Budget()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Constructor failed");
    expect(() => deepCopyToSandbox(result.returnValue as SandboxValue)).toThrow(/prototype links/i);
    expect(() => deepCopyFromSandbox(result.returnValue as SandboxValue)).toThrow(
      /prototype links/i
    );
  });

  it("validates all descriptors before defineProperties mutates its target", async () => {
    const result = await run(
      "const target = {}; try { Object.defineProperties(target, { valid: { value: 7 }, invalid: { get: 9 } }); } catch (error) {} return Object.hasOwn(target, 'valid');",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: false });
  });

  it("assigns existing writable properties without replacing their descriptors", async () => {
    const result = await run(
      "function Counter() {} Object.assign(Counter, { prototype: { value: 7 } }); Object.defineProperty(Counter, 'fixed', { value: 1, writable: true }); Object.assign(Counter, { fixed: 9 }); return [new Counter().value, Counter.fixed, Object.getOwnPropertyDescriptor(Counter, 'fixed').enumerable];",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: [7, 9, false] });
  });

  it.each([
    "function Counter() {} Counter.value = 7; return Counter;",
    "function Counter() {} return new Counter();",
    "function Parent() {} function Child() {} Object.setPrototypeOf(Child, Parent); return Child;",
    "Object.setPrototypeOf(Number, { value: 7 }); return Number;",
    "Object.setPrototypeOf(Number, null); return Number;"
  ])("preserves guest state in heap and direct run snapshots while refusing unsupported replay-data encoding: %s", async (source) => {
    const result = await run(source, { budget: new Budget() });
    if (!result.ok) throw new Error("Guest evaluation failed");
    expect(() => encodeReplayData(result.returnValue as SandboxValue)).toThrow(
      /function properties|prototype links/i
    );
    const snapshot = serialize({
        source,
        currentAstNodeId: 1,
        scopeChain: [{ id: 1, bindings: { value: result.returnValue as RuntimeSnapshotValue } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
    const restored = restoreInterpreterSnapshot(JSON.parse(JSON.stringify(snapshot)), { source });
    const binding = restored.currentScope.lookup("value");
    if (!binding.found) throw new Error("Missing restored guest value");
    expect(binding.value).not.toBe(result.returnValue);
    const recaptured = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { value: binding.value as RuntimeSnapshotValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    expect(JSON.parse(JSON.stringify(recaptured))).toEqual(JSON.parse(JSON.stringify(snapshot)));
    const resumed = await run(source, { snapshot: result.snapshot, budget: new Budget() });
    expect(resumed.ok).toBe(true);
    const resumedGraph = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { value: resumed.returnValue as RuntimeSnapshotValue } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    expect(JSON.parse(JSON.stringify(resumedGraph))).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it("keeps separate runs isolated", async () => {
    const first = await run(
      "function Counter() {} Counter.value = 7; Counter.prototype.shared = 9; return 1;",
      { budget: new Budget() }
    );
    const second = await run(
      "function Counter() {} return [Counter.value, new Counter().shared];",
      { budget: new Budget() }
    );
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, returnValue: [undefined, undefined] });
  });

  it("enumerates guest properties without internal closure fields", async () => {
    const result = await run(
      "function Counter() {} Counter.label = 7; const functionKeys = []; for (const key in Counter) functionKeys.push(key); Counter.prototype.visible = 1; Counter.prototype.hidden = 2; const instance = new Counter(); Object.defineProperty(instance, 'hidden', { value: 3 }); const instanceKeys = []; for (const key in instance) instanceKeys.push(key); return [functionKeys.join(','), instanceKeys.join(',')];",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: ["label", "visible"] });
  });

  it("uses the same property model for spread and destructuring", async () => {
    const result = await run(
      "function Counter() {} Counter.label = 7; Counter.extra = 9; const { label, ...rest } = Counter; const copy = { ...Counter }; ({ value: Counter.label } = { value: 11 }); return [label, rest.extra, Object.keys(rest).join(','), copy.label, Counter.label];",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: [7, 9, "extra", 7, 11] });
  });

  it("executes unmodified inherits 2.0.4 and exercises its constructor chain", async () => {
    const library = readFileSync(
      new URL("./fixtures/inherits-2.0.4/source.js.txt", import.meta.url),
      "utf8"
    );
    expect(createHash("sha256").update(library).digest("hex")).toBe(
      "ad322a7b1dec60f3d2ebda2091816469efb55b567d241cf3cf0fa4c5a4afe500"
    );
    const result = await run(
      `const module = { exports: undefined };\n${library}\nfunction Parent(value) { this.value = value; } Parent.prototype.read = function () { return this.value; }; function Child(value) { Parent.call(this, value); } module.exports(Child, Parent); const child = new Child(17); return [child.read(), child instanceof Child, child instanceof Parent, child.constructor === Child, Child.super_ === Parent, Object.getOwnPropertyDescriptor(Child.prototype, 'constructor').enumerable, Object.keys(Child.prototype).length];`,
      {
        budget: new Budget({ maxSteps: 10000, dataSize: 20000 })
      }
    );
    expect(result).toMatchObject({ ok: true, returnValue: [17, true, true, true, true, false, 0] });
  });
});

describe("guest function budgets", () => {
  it("accounts for hidden named array data created through descriptors", () => {
    const array: SandboxValue[] = [];
    Object.defineProperty(array, "hidden", { value: "data".repeat(100) });
    markDescriptorObject(array);
    expect(measureSandboxData([array])).toBeGreaterThanOrEqual(400);
  });
  it.each([
    "Object.setPrototypeOf([], {});",
    "function Counter() {} Counter.prototype = []; new Counter();"
  ])("supports explicit array prototype links: %s", async (source) => {
    expect(await run(`${source} return true;`, { budget: new Budget() }))
      .toMatchObject({ ok: true, returnValue: true });
  });

  it("rejects a non-callable instanceof operand", async () => {
    const result = await run(
      "try { const value = {} instanceof {}; return false; } catch (error) { return true; }",
      { budget: new Budget() }
    );
    expect(result).toMatchObject({ ok: true, returnValue: true });
  });

  it("charges non-enumerable function data and cannot catch fatal exhaustion", async () => {
    await expect(
      run(
        "function callback() {} try { for (let index = 0; index < 100; index++) Object.defineProperty(callback, 'hidden' + index, { value: [index, index, index, index] }); } catch (error) { return 'hidden'; } return 'escaped';",
        {
          budget: new Budget({ dataSize: 1000, maxSteps: 10000 })
        }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });
});
