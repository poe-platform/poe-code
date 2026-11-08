import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

// ECMAScript 2026 §§19.2.4–19.2.5: ToString precedes parsing, and
// parseInt converts its radix only after converting the input string.
describe.each(["parseInt", "Number.parseInt", "parseFloat", "Number.parseFloat"])(
  "%s guest conversion",
  (parser) => {
    it.each([
      "const value={toString(){return '12.5px'}};return PARSER(value)",
      "const value=Object.create({toString(){return '12.5px'}});return PARSER(value)",
      "const value={toString(){return {}},valueOf(){return '12.5px'}};return PARSER(value)",
      "const value={toString:null,valueOf(){return '12.5px'}};return PARSER(value)",
      "function value(){}value.toString=()=> '12.5px';return PARSER(value)",
      "const value=[];value.toString=()=> '12.5px';return PARSER(value)",
      "const value={toString(){return '-0'}};return [PARSER(value),1/PARSER(value)]",
      "const marker={};try{PARSER({toString(){throw marker}})}catch(error){return error===marker}",
      "const log=[];const value={toString(){log.push(this===value);return '12.5px'},valueOf(){log.push('wrong');return 99}};return [PARSER(value),log]",
      "const log=[];const value={async toString(){log.push('prefix');return '99'},valueOf(){log.push('fallback');return '12.5px'}};return [PARSER(value),log]",
      "const log=[];const value={toString(){log.push('string');return {}},valueOf(){log.push('value');return {}}};try{PARSER(value)}catch(error){return [error.name,log]}",
      "return [PARSER(),PARSER(null),PARSER(true),PARSER('  -Infinitysuffix'),PARSER('0x10'),PARSER('12.5px')]"
    ])("matches native conversion: %s", async (template) => {
      const source = template.replaceAll("PARSER", parser);
      const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    });

    it("preserves completed hook effects on replay", async () => {
      const source = `const value={toString(){return read()}};return ${parser}(value)`;
      let reads = 0;
      const bindings = {
        read: () => {
          reads++;
          return "12.5px";
        }
      };
      const original = await run(source, { bindings });
      const snapshot = restore(JSON.parse(await dump(original)), { source });
      const replay = await run(source, { bindings, snapshot });
      expect(replay).toMatchObject({ ok: true, returnValue: original.returnValue });
      expect(reads).toBe(1);
    });

    it("uses the realm's conversion hooks", async () => {
      const realm = createRealm();
      try {
        const result = await realm.evaluate(
          `const value={toString(){return '12.5px'}};return ${parser}(value)`
        );
        expect(result).toMatchObject({
          ok: true,
          returnValue: parser.endsWith("parseInt") ? 12 : 12.5
        });
      } finally {
        await realm.close();
      }
    });

    it("enforces the converted string's budget", async () => {
      const source = `const value={toString(){return 123456789}};try{return ${parser}(value)}catch(error){return 0}`;
      await expect(run(source, { budget: new Budget({ stringLength: 5 }) })).rejects.toMatchObject({
        code: "budgetExceeded"
      });
    });

    it("does not drain promise jobs in a synchronous conversion", async () => {
      const source = `const log=[];Promise.resolve().then(()=>log.push('job'));const value={toString(){log.push('string');return '12.5px'}};log.push(${parser}(value));log.push('after');await 0;return log`;
      const expected = await runInNewContext(`(async()=>{${source}})()`);
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    });

    it("keeps the hook step budget fatal", async () => {
      const budget = new Budget({ maxSteps: 1000 });
      await expect(
        run(`try{return ${parser}({toString(){while(true){}}})}catch(error){return 0}`, { budget })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
      expect([...budget.retainedValues()]).toEqual([]);
    });

    it("bounds recursive conversion and releases its roots", async () => {
      const budget = new Budget({ maxCallDepth: 20 });
      await expect(
        run(
          `const value={toString(){return ${parser}(value)}};try{return ${parser}(value)}catch(error){return 0}`,
          { budget }
        )
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "callDepth" });
      expect([...budget.retainedValues()]).toEqual([]);
    });
  }
);

describe.each(["parseInt", "Number.parseInt"])("%s radix conversion", (parser) => {
  it("retains generated input text while converting the radix", async () => {
    const source = `const value={toString(){return '1'.repeat(5000)}};const radix={valueOf(){const temporary='x'.repeat(5000);return 10}};return ${parser}(value,radix)`;
    const budget = new Budget({ dataSize: 8000 });
    await expect(run(source, { budget })).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
    expect([...budget.retainedValues()]).toEqual([]);
    expect(await run(source, { budget: new Budget({ dataSize: 20000 }) })).toMatchObject({
      ok: true,
      returnValue: Infinity
    });
  });

  it.each([
    "const log=[];const value={toString(){log.push('string');return '11'}};const radix={valueOf(){log.push('radix');return 2}};return [PARSER(value,radix),log]",
    "return PARSER('11',{valueOf(){return {}},toString(){return '2'}})",
    "const marker={};try{PARSER('11',{valueOf(){throw marker}})}catch(error){return error===marker}",
    "const log=[];const marker={};try{PARSER({toString(){throw marker}},{valueOf(){log.push('wrong');return 2}})}catch(error){return [error===marker,log]}",
    "let text='11';return PARSER({toString(){return text}},{valueOf(){text='22';return 2}})",
    "return [PARSER('11',{valueOf(){return 4294967298}}),PARSER('11',{valueOf(){return -4294967294}}),PARSER('11',{valueOf(){return 2.9}})]"
  ])("matches native radix evaluation: %s", async (template) => {
    const source = template.replaceAll("PARSER", parser);
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
