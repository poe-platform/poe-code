import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { decodeReplayData, encodeReplayData } from "../snapshot/replay-data.js";
import { serializeSafeJSSnapshot } from "../snapshot/dump-format.js";
import { boxedValue, createSandboxBox, isSandboxBox } from "./boxed.js";
import { deepCopyFromSandbox, deepCopyToSandbox, type SandboxValue } from "./values.js";

describe("boxed primitive boundaries", () => {
  it.each(["+", "-", "<", ">"])(
    "retains converted left operands during boxed %s coercion",
    async (operator) => {
      const source = `const left=new Number(0);left.valueOf=()=> 'x'.repeat(4000);const right=new Number(0);right.valueOf=()=>{const padding='y'.repeat(3000);check(padding);return 1};return (left ${operator} right)===undefined`;
      let checks = 0;
      await expect(
        run(source, {
          budget: new Budget({ dataSize: 9000 }),
          bindings: {
            check: () => {
              checks++;
            }
          }
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(checks).toBe(0);
    }
  );

  it("allows the smaller converted-operand control at the same budget", async () => {
    const source =
      "const left=new Number(0);left.valueOf=()=> 'x';const right=new Number(0);right.valueOf=()=>{const padding='y'.repeat(3000);check(padding);return 1};return left+right";
    expect(
      await run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: { check: () => undefined }
      })
    ).toMatchObject({ ok: true, returnValue: "x1" });
  });

  it.each(["+=", "-=", "*=", "/="])(
    "checks converted compound %s operands before host effects",
    async (operator) => {
      const source = `let left=new Number(0);left.valueOf=()=> 'x'.repeat(4000);const right=new Number(0);right.valueOf=()=>{const padding='y'.repeat(3000);check(padding);return 1};left ${operator} right;return 0`;
      let checks = 0;
      await expect(
        run(source, {
          budget: new Budget({ dataSize: 9000 }),
          bindings: {
            check: () => {
              checks++;
            }
          }
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(checks).toBe(0);
    }
  );
  it.each([
    "const value=new String('ab');value.toString=()=> 'xy😀';return await Promise.all(value)",
    "const value=new String('ab');value.toString=()=> 'xy😀';function* items(){yield* value}return [...items()]"
  ])("uses converted wrapper text in asynchronous iteration: %s", async (source) => {
    expect(await run(source)).toMatchObject({ ok: true, returnValue: ["x", "y", "😀"] });
  });

  it("does not repeat string iteration conversion across checkpoint replay", async () => {
    const source =
      "let calls=0;const value=new String('ab');value.toString=()=>{calls++;return 'xy😀'};const items=[];for(const item of value){items.push(item);await 0}return [items,calls]";
    const pending = run(source);
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    expect(await pending).toMatchObject({ ok: true, returnValue: [["x", "y", "😀"], 1] });
    expect(await run(source, { snapshot })).toMatchObject({
      ok: true,
      returnValue: [["x", "y", "😀"], 1]
    });
  });

  it("keeps boxed string iteration conversion budgets fatal", async () => {
    await expect(
      run(
        "const value=new String('a');value.toString=()=>{while(true){}};try{return [...value]}catch(error){return 0}",
        { budget: new Budget({ maxSteps: 1000 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
  it.each([3, "ab", false])(
    "records frozen wrapper descriptors in public heap data: %s",
    (primitive) => {
      const value = createSandboxBox(primitive);
      value.extra = 3;
      Object.freeze(value);
      const snapshot = JSON.parse(
        serializeSafeJSSnapshot({ sourceHash: "test", bindings: { value } })
      );
      expect(snapshot.heap[snapshot.bindings.value.id]).toMatchObject({
        kind: "boxed",
        extensible: false,
        properties: {
          extra: { value: 3, writable: false, configurable: false, enumerable: true }
        }
      });
    }
  );
  it.each([NaN, -0, Infinity, -Infinity, 7, "😀", false])(
    "preserves payload and cycles in replay data: %s",
    (primitive) => {
      const value = createSandboxBox(primitive);
      value.self = value;
      const decoded = decodeReplayData(
        JSON.parse(JSON.stringify(encodeReplayData([value, value])))
      ) as SandboxValue[];
      expect(decoded[0]).toBe(decoded[1]);
      expect(isSandboxBox(decoded[0])).toBe(true);
      expect(boxedValue(decoded[0] as object)).toBe(primitive);
      expect((decoded[0] as { self: unknown }).self).toBe(decoded[0]);
    }
  );

  it.each([NaN, -0, Infinity, -Infinity, 7, "😀", false])(
    "preserves payload across checkpoint restore: %s",
    async (primitive) => {
      const source =
        "const value=Object(input);value.self=value;await 0;return [value.valueOf(),value.self===value]";
      const pending = run(source, { bindings: { input: primitive } });
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      await pending;
      expect(await run(source, { snapshot, bindings: { input: primitive } })).toMatchObject({
        ok: true,
        returnValue: [primitive, true]
      });
    }
  );

  it.each([3, "ab", false])("exports and reimports genuine boxed host values: %s", (primitive) => {
    const original = Object.assign(Object(primitive), { self: undefined as unknown });
    original.self = original;
    const imported = deepCopyToSandbox(original);
    expect(boxedValue(imported as object)).toBe(primitive);
    const exported = deepCopyFromSandbox(imported) as { self: unknown; valueOf(): unknown };
    expect(exported.self).toBe(exported);
    expect(exported.valueOf()).toBe(primitive);
  });

  it("enforces the string limit on boxed host input", async () => {
    await expect(
      run("return value.length", {
        bindings: { value: new String("x".repeat(1000)) },
        budget: new Budget({ stringLength: 128 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it("preserves explicitly defined boxed data descriptors through checkpoints", async () => {
    const source =
      "const value=new String('ab');Object.defineProperty(value,'hidden',{value:7});await 0;return [value.valueOf(),Object.getOwnPropertyDescriptor(value,'hidden')]";
    const pending = run(source);
    const snapshot = restore(JSON.parse(await dump(pending)), { source });
    const expected = await pending;
    expect(await run(source, { snapshot })).toMatchObject({
      ok: true,
      returnValue: expected.returnValue
    });
  });

  it("indexes hidden cyclic data in boxed heap properties", () => {
    const value = createSandboxBox(3);
    const hidden: Record<string, unknown> = {};
    hidden.self = hidden;
    Object.defineProperty(value, "hidden", { value: hidden });
    const snapshot = JSON.parse(
      serializeSafeJSSnapshot({ sourceHash: "test", bindings: { value } })
    );
    const box = snapshot.heap[snapshot.bindings.value.id];
    const hiddenRef = box.properties.hidden.value;
    expect(snapshot.heap[hiddenRef.id].entries.self).toEqual(hiddenRef);
  });

  it.each(["Number", "String", "Boolean"])(
    "preserves frozen %s descriptors across snapshots",
    async (name) => {
      const source = `const value=new ${name}('7');value.extra=3;Object.freeze(value);await 0;return [value.valueOf(),Object.isFrozen(value),Object.getOwnPropertyDescriptor(value,'extra')]`;
      const pending = run(source);
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      const expected = await pending;
      expect(await run(source, { snapshot })).toMatchObject({
        ok: true,
        returnValue: expected.returnValue
      });
    }
  );

  it.each(["Number", "String", "Boolean"])(
    "clones a frozen %s without copying custom fields",
    async (name) => {
      expect(
        await run(
          `const value=new ${name}('7');value.extra=3;Object.freeze(value);const copy=structuredClone(value);return [copy.extra,Object.isFrozen(copy),copy.valueOf()]`
        )
      ).toMatchObject({
        ok: true,
        returnValue: [undefined, false, name === "Number" ? 7 : name === "String" ? "7" : true]
      });
    }
  );

  it("does not retain intrinsic prototype mutations after closing a realm", async () => {
    const budget = new Budget({ dataSize: 1500 });
    for (let index = 0; index < 3; index++) {
      const realm = createRealm({ budget });
      try {
        expect(
          await realm.evaluate(
            "Number.prototype.extra='x'.repeat(700);return new Number(3).valueOf()"
          )
        ).toMatchObject({ ok: true, returnValue: 3 });
      } finally {
        await realm.close();
      }
    }
    const realm = createRealm({ budget });
    try {
      expect(await realm.evaluate("return Number.prototype.extra")).toMatchObject({
        ok: true,
        returnValue: undefined
      });
    } finally {
      await realm.close();
    }
  });

  it.each([
    null,
    {},
    { tag: "ref", id: 0 },
    { tag: "undefined" },
    { tag: "number", value: "wrong" }
  ])("rejects malformed replay payloads: %j", (value) => {
    expect(() =>
      decodeReplayData({
        root: { tag: "ref", id: 0 },
        nodes: [{ kind: "boxed", value, properties: {}, extensible: true }]
      })
    ).toThrow();
  });
});
