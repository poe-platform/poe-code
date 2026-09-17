import { describe, expect, it } from "vitest";
import { run } from "../../run.js";

// ECMA-262 edition 16 §§22.1.3.13, 22.1.3.14, 22.1.3.21:
// RegExpCreate is followed by Invoke on the newly created object's symbol hook.
describe.each(["match", "matchAll", "search"] as const)("String %s fallback hooks", method => {
  it.each(["undefined", "null", "'a'"])("invokes the current prototype hook for %s", async pattern => {
    const result = await run(`
      RegExp.prototype[Symbol.${method}] = function(input) {
        return [this instanceof RegExp, this.source, this.flags, input, arguments.length];
      };
      return 'aba'.${method}(${pattern});
    `);
    expect(result).toMatchObject({ ok: true, returnValue: [true,
      pattern === "undefined" ? "(?:)" : pattern === "null" ? "null" : "a",
      method === "matchAll" ? "g" : "", "aba", 1] });
  });

  it.each(["undefined", "7"])("rejects a noncallable created-object hook %s", async hook => {
    expect(await run(`RegExp.prototype[Symbol.${method}]=${hook};
      try { return 'aba'.${method}(); } catch(e) { return e.name; }`))
      .toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it("keeps budget failure inside the created-object callback fatal", async () => {
    await expect(run(`RegExp.prototype[Symbol.${method}]=function(){
      return /^(a+)+Z$/.test('aaaaaaaaaaaaaaaaaaaaaaaa!');
    };try { return 'a'.${method}(); } catch(e) { return 'caught'; }`))
      .rejects.toMatchObject({ code: "budgetExceeded" });
  });

  it("creates a new pattern after a deleted hook on a RegExp argument", async () => {
    expect(await run(`delete RegExp.prototype[Symbol.${method}];
      try { return 'aba'.${method}(/a/g); } catch(e) { return e.name; }`))
      .toMatchObject({ ok: true, returnValue: "TypeError" });
  });

  it("keeps the default hook as a passing control", async () => {
    const expression = method === "search" ? "'aba'.search('a')"
      : method === "match" ? "'aba'.match('a').index" : "Array.from('aba'.matchAll('a'), m => m.index)";
    expect(await run(`return ${expression}`)).toMatchObject({ ok: true, returnValue: method === "matchAll" ? [0, 2] : 0 });
  });
});

it("retains edition-16 primitive symbol lookup despite newer upstream expectations", async () => {
  expect(await run(`Object.defineProperty(Number.prototype,Symbol.match,{get(){throw 'observed'}});
    try{'a1'.match(1)}catch(e){return e}`)).toMatchObject({ ok: true, returnValue: "observed" });
});
