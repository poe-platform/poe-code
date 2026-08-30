import { describe, expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { run } from "../run.js";
import { interpret } from "./interpreter.js";
import {
  createSandboxClosure,
  deepCopyToSandbox,
  measureSandboxData,
  type SandboxObject,
  type SandboxValue
} from "./values.js";

const witnesses = [
  { name: "array callable", array: true, kind: "callable", optional: false },
  { name: "object callable", array: false, kind: "callable", optional: false },
  { name: "array noncallable", array: true, kind: "zero", optional: false },
  { name: "object optional null", array: false, kind: "null", optional: true }
] as const;

describe("G01 independent measurement purity", () => {
  it.each(
    [true, false].flatMap((array) => [true, false].map((enumerable) => ({ array, enumerable })))
  )(
    "leaves descriptors and state unchanged: array=$array enumerable=$enumerable",
    ({ array, enumerable }) => {
      const target: Record<string, unknown> | unknown[] = array ? [] : {};
      const key = array ? "0" : "field";
      const effects: string[] = [];
      Object.defineProperty(target, key, {
        enumerable,
        configurable: true,
        get() {
          effects.push("read");
          return "abc";
        },
        set() {
          effects.push("write");
        }
      });
      const descriptors = Object.getOwnPropertyDescriptors(target);
      const keys = Reflect.ownKeys(target);
      const sizes = [measureSandboxData([target]), measureSandboxData([target, target])];

      expect(effects).toEqual([]);
      expect(sizes).toEqual(array ? [2, 2] : enumerable ? [7, 7] : [1, 1]);
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors);
      expect(Reflect.ownKeys(target)).toEqual(keys);
      expect(Reflect.get(target, key)).toBe("abc");
      expect(effects).toEqual(["read"]);
    }
  );

  it("retains stored values, holes, aliases and a cycle without modifying the graph", () => {
    const shared: SandboxObject = { text: "abc" };
    shared.self = shared;
    Object.defineProperty(shared, "hidden", { value: "unmeasured", enumerable: false });
    const rows: SandboxValue[] = [shared];
    rows.length = 4;
    rows[2] = shared;
    Object.defineProperty(rows, "1", { value: "xy", enumerable: false });
    const before = Object.getOwnPropertyDescriptors(rows);

    expect(measureSandboxData([rows])).toBe(21);
    expect(measureSandboxData([shared, rows, rows])).toBe(21);
    expect(Object.getOwnPropertyDescriptors(rows)).toEqual(before);
    expect(rows[0]).toBe(rows[2]);
    expect(shared.self).toBe(shared);
    expect(Object.hasOwn(rows, "3")).toBe(false);
    expect(rows.length).toBe(4);
  });
});

describe.each([true, false])("G01 original benign witnesses, enumerable=%s", (enumerable) => {
  it.each(witnesses)(
    "$name matches native including the final total read count",
    async (witness) => {
      const source = `
      let current = target;
      function receiver() { trace.push("receiver"); return current; }
      function key() { trace.push("key"); return "${witness.array ? "map" : "method"}"; }
      function argument() { trace.push("argument"); current = { value: 100 }; return 3; }
      let result;
      try { result = receiver()[key()]${witness.optional ? "?." : ""}(argument()); }
      catch (error) { result = error.name; }
      return [result, trace.slice(), current.value];
    `;
      const expectedTrace = ["receiver", "key", "get"];
      if (witness.kind !== "null") expectedTrace.push("argument");
      if (witness.kind === "callable") expectedTrace.push("call");
      const expected = [
        witness.kind === "callable" ? 10 : witness.kind === "zero" ? "TypeError" : undefined,
        expectedTrace,
        witness.kind === "null" ? 7 : 100
      ];

      function fixture(sandbox: boolean) {
        const trace: string[] = [];
        let reads = 0;
        const target = Object.assign(witness.array ? [] : {}, { value: 7 });
        Object.defineProperty(target, witness.array ? "map" : "method", {
          enumerable,
          configurable: true,
          get() {
            reads += 1;
            trace.push("get");
            if (witness.kind === "null") return null;
            if (witness.kind === "zero") return 0;
            if (!sandbox) {
              return function (this: { value: number }, argument: number) {
                trace.push("call");
                return reads === 1 ? this.value + argument : -1;
              };
            }
            return createSandboxClosure({
              name: "captured",
              sandbox: true,
              call: (args, context) => {
                trace.push("call");
                const receiver = context?.thisValue as SandboxObject;
                return reads === 1 ? (receiver.value as number) + (args[0] as number) : -1;
              }
            });
          }
        });
        return { target, trace, reads: () => reads };
      }

      const native = fixture(false);
      const nativeResult = new Function("target", "trace", source)(native.target, native.trace);
      expect(nativeResult).toEqual(expected);
      expect(native.trace).toEqual(expectedTrace);
      expect(native.reads()).toBe(1);

      const sandbox = fixture(true);
      const result = await interpret(
        { ...parseModule(source), type: "BlockStatement" },
        { bindings: { target: sandbox.target, trace: sandbox.trace } }
      );
      expect.soft(result).toMatchObject({ ok: true, returnValue: nativeResult });
      expect.soft(sandbox.trace).toEqual(native.trace);
      expect.soft(sandbox.reads()).toBe(native.reads());
      expect(sandbox.target.value).toBe(7);
    }
  );
});

describe("G01 unchanged public object boundaries", () => {
  it.each(["copy", "binding", "host-result"])(
    "%s refuses without observable reads",
    async (boundary) => {
      const effects: string[] = [];
      const target = { value: 7 };
      Object.defineProperty(target, "method", {
        enumerable: true,
        get() {
          effects.push("get");
          return 0;
        }
      });
      const descriptors = Object.getOwnPropertyDescriptors(target);

      if (boundary === "copy") {
        expect(() => deepCopyToSandbox(target)).toThrow("accessor property");
      } else if (boundary === "binding") {
        await expect(run("return 1;", { bindings: { target } })).rejects.toThrow(
          "accessor property"
        );
      } else {
        await expect(run("return read();", { bindings: { read: () => target } })).rejects.toThrow(
          "accessor property"
        );
      }
      expect(effects).toEqual([]);
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(descriptors);
    }
  );
});
