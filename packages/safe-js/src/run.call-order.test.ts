import { describe, expect, it } from "vitest";

import { run } from "./run.js";

describe.each(["target", "({ method: target }).method"])("call ordering for %s", (callee) => {
  it.each(["undefined", "null", "false", "0", '""'])(
    "evaluates arguments before rejecting %s except for nullish optional calls",
    async (literal) => {
      const source = `
        const target = ${literal};
        const trace = [];
        function argument() { trace.push("argument"); return 1; }
        try { ${callee}(argument()); } catch (error) { trace.push(error.name); }
        try { ${callee}?.(argument()); } catch (error) { trace.push(error.name); }
        return trace;
      `;
      const expected = ["argument", "TypeError"];
      if (literal !== "undefined" && literal !== "null") {
        expected.push("argument", "TypeError");
      }
      const native = new Function(`"use strict"; ${source}`)();
      expect(native).toEqual(expected);

      await expect(run(source, { modules: {} })).resolves.toMatchObject({
        ok: true,
        returnValue: native
      });
    }
  );
});

describe("call reference and argument evaluation", () => {
  it.each([
    {
      name: "captures the callable and receiver before argument mutation",
      source: `
        const trace = [];
        let target = { value: 7, method: function(value) { trace.push("call"); return this.value + value; } };
        const original = target;
        function receiver() { trace.push("receiver"); return target; }
        function key() { trace.push("key"); return "method"; }
        function argument() {
          trace.push("argument");
          original.method = 0;
          target = { value: 100 };
          return 3;
        }
        return [receiver()[key()](argument()), trace, original.method, target.value];
      `,
      expected: [10, ["receiver", "key", "argument", "call"], 0, 100]
    },
    {
      name: "does not reread a noncallable member replaced by an argument",
      source: `
        const trace = [];
        const target = { method: 0 };
        function receiver() { trace.push("receiver"); return target; }
        function key() { trace.push("key"); return "method"; }
        function argument() {
          trace.push("argument");
          target.method = () => trace.push("replacement");
          return 1;
        }
        try { receiver()[key()](argument()); } catch (error) { trace.push(error.name); }
        target.method();
        return trace;
      `,
      expected: ["receiver", "key", "argument", "TypeError", "replacement"]
    },
    {
      name: "preserves a thrown argument before noncallable rejection",
      source: `
        const trace = [];
        const target = 0;
        function argument() { trace.push("argument"); throw new Error("argument failure"); }
        try { target(argument(), trace.push("later")); } catch (error) { trace.push(error.message); }
        return trace;
      `,
      expected: ["argument", "argument failure"]
    },
    {
      name: "evaluates spread arguments in order before noncallable rejection",
      source: `
        const trace = [];
        const target = false;
        function* values() {
          trace.push("spread first");
          yield 1;
          trace.push("spread second");
          yield 2;
        }
        try { target(trace.push("first"), ...values(), trace.push("last")); }
        catch (error) { trace.push(error.name); }
        return trace;
      `,
      expected: ["first", "spread first", "spread second", "last", "TypeError"]
    },
    {
      name: "short-circuits the key and arguments for a nullish receiver",
      source: `
        const trace = [];
        function receiver() { trace.push("receiver"); return null; }
        function key() { trace.push("key"); return "method"; }
        function argument() { trace.push("argument"); return 1; }
        return [receiver()?.[key()](argument()), trace];
      `,
      expected: [undefined, ["receiver"]]
    }
  ])("$name", async ({ source, expected }) => {
    const native = new Function(`"use strict"; ${source}`)();
    expect(native).toEqual(expected);

    await expect(run(source, { modules: {} })).resolves.toMatchObject({
      ok: true,
      returnValue: native
    });
  });
});
