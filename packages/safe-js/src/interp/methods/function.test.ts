import { describe, expect, it } from "vitest";

import { parse, type ParseResult, type Statement } from "../../parse.js";
import { interpret } from "../interpreter.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext } from "../values.js";
import { getFunctionMember } from "./function.js";

describe("function methods", () => {
  it("exposes declared arity without exposing host implementation arity", () => {
    const options = { callClosure: () => undefined };
    const target = createSandboxClosure({ length: 2, call: () => undefined });
    expect(getFunctionMember(target, "length", options)).toBe(2);
    expect(Object.keys(target)).not.toContain("length");
    expect(
      getFunctionMember(createSandboxClosure({ call: () => undefined }), "length", options)
    ).toBeUndefined();
  });

  it.each([undefined, 7])(
    "keeps explicit length properties ahead of arity metadata: %s",
    (length) => {
      const target = createSandboxClosure({
        length: 2,
        properties: { length },
        call: () => undefined
      });
      expect(getFunctionMember(target, "length", { callClosure: () => undefined })).toBe(length);
    }
  );

  it("invokes call immediately with the supplied this value and arguments", async () => {
    const contexts: (SandboxCallContext | undefined)[] = [];
    const target = createSandboxClosure({
      call: (args, context) => {
        contexts.push(context);
        return [context?.thisValue, ...args];
      },
      name: "target"
    });
    const call = getFunctionMember(target, "call", {
      callClosure: (closure, args, stack, thisValue) => closure.call(args, { stack, thisValue })
    });

    expect(isSandboxClosure(call)).toBe(true);
    expect(call?.call([{ receiver: true }, 1, 2], { stack: ["caller"], thisValue: null })).toEqual([
      { receiver: true },
      1,
      2
    ]);
    expect(contexts).toEqual([{ stack: ["caller"], thisValue: { receiver: true } }]);
  });

  it("invokes apply immediately with the supplied this value and argument array", async () => {
    const target = createSandboxClosure({
      call: (args, context) => [context?.thisValue, ...args],
      name: "target"
    });
    const apply = getFunctionMember(target, "apply", {
      callClosure: (closure, args, stack, thisValue) => closure.call(args, { stack, thisValue })
    });

    expect(apply?.call(["receiver", [1, 2]], { stack: [], thisValue: undefined })).toEqual([
      "receiver",
      1,
      2
    ]);
    expect(apply?.call(["receiver", undefined], { stack: [], thisValue: undefined })).toEqual([
      "receiver"
    ]);
    expect(apply?.call([], { stack: [], thisValue: undefined })).toEqual([undefined]);
    expect(apply?.call(["receiver", null], { stack: [], thisValue: undefined })).toEqual([
      "receiver"
    ]);
    expect(() => apply?.call(["receiver", {}], { stack: [], thisValue: undefined })).toThrow(
      "Function#apply requires an array or nullish arguments value."
    );
  });

  it("keeps closure properties ahead of built-in function members", async () => {
    const customCall = createSandboxClosure({ call: (_args, context) => context?.thisValue });
    const target = createSandboxClosure({
      call: () => "target",
      properties: { call: customCall }
    });

    await expect(
      interpret(parse("return target.call()"), {
        bindings: { target }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: target
    });
  });

  it("keeps an explicitly undefined closure property ahead of built-in members", () => {
    const target = createSandboxClosure({
      call: () => "target",
      properties: { call: undefined }
    });

    expect(
      getFunctionMember(target, "call", {
        callClosure: async () => "built-in"
      })
    ).toBeUndefined();
  });

  it("supports call and apply through closure member access", async () => {
    await expect(
      interpret(
        block(
          parse("function target(first, second) { return [this.value, first, second]; }"),
          parse(
            'return [target.call({ value: "call" }, 1, 2), target.apply({ value: "apply" }, [3, 4])];'
          )
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        ["call", 1, 2],
        ["apply", 3, 4]
      ]
    });
  });

  it("supports computed and detached function method access", async () => {
    await expect(
      interpret(
        block(
          parse("function target(value) { return [this, value]; }"),
          parse('const call = target["call"];'),
          parse('const apply = target["apply"];'),
          parse('return [call("receiver", 1), apply(null, [2])];')
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        ["receiver", 1],
        [null, 2]
      ]
    });
  });

  it("uses undefined for an omitted call receiver and ignores extra apply arguments", async () => {
    await expect(
      interpret(
        block(
          parse("function target(...args) { return [this, args]; }"),
          parse("return [target.call(), target.apply(undefined, [1, 2], [3])];")
        )
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: [
        [undefined, []],
        [undefined, [1, 2]]
      ]
    });
  });

  it("does not expose unknown methods and reports the closed-world method error", async () => {
    const target = createSandboxClosure({ call: () => undefined });

    expect(
      getFunctionMember(target, "missing", {
        callClosure: async () => undefined
      })
    ).toBeUndefined();
    await expect(
      interpret(parse("return target.missing"), {
        bindings: { target }
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: undefined
    });
    await expect(
      interpret(parse("return target.missing(null)"), {
        bindings: { target }
      })
    ).rejects.toMatchObject({
      name: "TypeError",
      message: "Function#missing is not a supported method."
    });
  });
});

function block(...statements: Statement[]): ParseResult {
  return {
    type: "BlockStatement",
    body: statements,
    span: {
      start: statements[0].span.start,
      end: statements.at(-1)?.span.end ?? statements[0].span.end
    }
  };
}
