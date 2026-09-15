import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";

// Hook work belongs to the same guest budget as the surrounding String operation.
const hooks = [
  ["replacement callback", "return 'a'.replace(/a/, function () { HOOK });", "x"],
  ["bound replacement receiver", "const owner={value:'x'}; return 'a'.replace(/a/, function () { if(this!==owner) throw Error('owner'); HOOK }.bind(owner));", "x"],
  ["split species", "const r=/a/;r.constructor={[Symbol.species]:function(){ HOOK }};return r[Symbol.split]('a');", ["", ""]],
  ["matchAll species", "const r=/a/g;r.constructor={[Symbol.species]:function(){ HOOK }};return Array.from(r[Symbol.matchAll]('a'),m=>m[0]);", ["a"]],
  ["lastIndex coercion", "const r=/a/g;r.lastIndex={valueOf(){ HOOK }};return r.exec('a')[0];", "a"],
  ["overridden exec", "const r=/a/;r.exec=function(){ HOOK };return 'a'.match(r);", null]
] as const;

const successfulHooks = ["return 'x'", "return this.value", "return /a/y", "return /a/g", "return 0", "return null"];

describe("RegExp guest hook semantics and fatal resource accounting", () => {
  for (const [index, [name, template, expected]] of hooks.entries()) {
    it(`${name} preserves its successful result`, async () => {
      const result = await run(template.replace("HOOK", successfulHooks[index]));
      expect(result).toMatchObject({ ok: true, returnValue: expected });
    });

    it(`${name} propagates ordinary guest throws`, async () => {
      const source = template.replace("HOOK", "throw 'hook-failure'");
      expect(await run(`try { ${source} } catch (error) { return error; }`))
        .toMatchObject({ ok: true, returnValue: "hook-failure" });
    });

    it(`${name} cannot catch or replace budget rejection`, async () => {
      const source = template.replace("HOOK", "while (true) {}");
      await expect(run(`try { ${source} } catch (error) { return 'caught'; }
        finally { return 'overridden'; }`, { budget: new Budget({ maxSteps: 2000 }) }))
        .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps", limit: 2000 });
    });
  }
});
