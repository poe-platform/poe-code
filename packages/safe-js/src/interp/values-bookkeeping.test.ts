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

type GetterCase = {
  array: boolean;
  enumerable: boolean;
  kind: "callable" | "zero" | "null";
  optional: boolean;
};

function getterFixture({ array, enumerable, kind }: GetterCase, sandbox: boolean) {
  const trace: string[] = [];
  const target = Object.assign(array ? [] : {}, { value: 7 });
  let reads = 0;
  Object.defineProperty(target, array ? "map" : "method", {
    enumerable,
    configurable: true,
    get() {
      trace.push("get");
      reads += 1;
      if (kind === "zero") return 0;
      if (kind === "null") return null;
      if (sandbox) {
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
      return function (this: { value: number }, value: number) {
        trace.push("call");
        return reads === 1 ? this.value + value : -1;
      };
    }
  });
  return { target, trace, reads: () => reads };
}

describe("side-effect-free value measurement", () => {
  it.each([true, false])("does not invoke object getters (enumerable: %s)", (enumerable) => {
    let reads = 0;
    const target = { value: "abc" };
    Object.defineProperty(target, "method", {
      enumerable,
      get() {
        reads += 1;
        return "result";
      }
    });

    expect(measureSandboxData([target])).toBe(enumerable ? 17 : 10);
    expect(reads).toBe(0);
  });

  it.each([true, false])("does not invoke array index getters (enumerable: %s)", (enumerable) => {
    let reads = 0;
    const target = ["abc"];
    Object.defineProperty(target, "1", {
      enumerable,
      get() {
        reads += 1;
        return "result";
      }
    });

    expect(measureSandboxData([target])).toBe(6);
    expect(reads).toBe(0);
  });

  it("preserves data-property accounting, array holes, aliases and cycles", () => {
    const shared: SandboxObject = { text: "abc" };
    const rows: SandboxValue[] = [shared];
    rows.length = 4;
    rows[2] = shared;
    shared.self = shared;
    Object.defineProperty(rows, "1", { value: "xy", enumerable: false });
    Object.defineProperty(shared, "hidden", { value: "ignored", enumerable: false });

    expect(measureSandboxData([rows, shared])).toBe(21);
  });
});

describe.each([true, false])("internal getter call order (enumerable: %s)", (enumerable) => {
  it.each(
    [true, false].flatMap((array) =>
      [
        { kind: "callable", optional: false },
        { kind: "zero", optional: false },
        { kind: "zero", optional: true },
        { kind: "null", optional: true }
      ].map((mode) => ({ array, enumerable, ...mode }) as GetterCase)
    )
  )("array=$array kind=$kind optional=$optional", async (testCase) => {
    const source = `
      let current = target;
      function receiver() { trace.push("receiver"); return current; }
      function key() { trace.push("key"); return "${testCase.array ? "map" : "method"}"; }
      function argument() { trace.push("argument"); current = { value: 100 }; return 3; }
      let result;
      try { result = receiver()[key()]${testCase.optional ? "?." : ""}(argument()); }
      catch (error) { result = error.name; }
      return [result, trace.slice(), current.value];
    `;
    const expected =
      testCase.kind === "null"
        ? [undefined, ["receiver", "key", "get"], 7]
        : testCase.kind === "zero"
          ? ["TypeError", ["receiver", "key", "get", "argument"], 100]
          : [10, ["receiver", "key", "get", "argument", "call"], 100];
    const nativeFixture = getterFixture(testCase, false);
    const native = new Function("target", "trace", source)(
      nativeFixture.target,
      nativeFixture.trace
    );
    expect(native).toEqual(expected);
    expect(nativeFixture.reads()).toBe(1);

    const sandboxFixture = getterFixture(testCase, true);
    const result = await interpret(
      { ...parseModule(source), type: "BlockStatement" },
      { bindings: { target: sandboxFixture.target, trace: sandboxFixture.trace } }
    );
    expect(result).toMatchObject({ ok: true, returnValue: native });
    expect(sandboxFixture.reads()).toBe(1);
  });
});

describe("public object accessor boundaries", () => {
  it.each(["copy", "binding", "host result"])(
    "refuses %s before invoking a getter",
    async (boundary) => {
      const fixture = getterFixture(
        { array: false, enumerable: true, kind: "zero", optional: false },
        false
      );

      if (boundary === "copy") {
        expect(() => deepCopyToSandbox(fixture.target)).toThrow("accessor property");
      } else if (boundary === "binding") {
        await expect(run("return 1;", { bindings: { target: fixture.target } })).rejects.toThrow(
          "accessor property"
        );
      } else {
        await expect(
          run("return read();", { bindings: { read: () => fixture.target } })
        ).rejects.toMatchObject({
          name: "TypeError",
          message: expect.stringContaining("accessor property")
        });
      }
      expect(fixture.reads()).toBe(0);
    }
  );

  it("omits nonenumerable host fields without invoking them", () => {
    const fixture = getterFixture(
      { array: false, enumerable: false, kind: "zero", optional: false },
      false
    );
    const copy = deepCopyToSandbox(fixture.target) as object;

    expect(Object.hasOwn(copy, "method")).toBe(false);
    expect(fixture.reads()).toBe(0);
  });
});
