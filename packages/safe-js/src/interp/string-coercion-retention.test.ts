import { describe, expect, it } from "vitest";
import { Budget, run } from "../core.js";

describe("intermediate strings during coercion", () => {
  it.each([
    "String([{toString:first},{toString:last}])",
    "String([[{toString:first}],{toString:last}])",
    "String((function(){const error=new Error();error.name={toString:first};error.message={toString:last};return error})())",
    "({})[[{toString:first},{toString:last}]]"
  ])("retains the converted prefix through the next hook: %s", async expression => {
    const source = `function first(){return 'b'.repeat(2000)}function last(){const temporary='y'.repeat(5000);throw 'allocated'}try{return ${expression}}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    const accepted = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget: accepted })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...accepted.retainedValues()]).toEqual([]);
  });

  it("permits the later allocation when the converted prefix is empty", async () => {
    const budget = new Budget({ dataSize: 6000 });
    expect(await run("function first(){return ''}function last(){const temporary='y'.repeat(5000);throw 'allocated'}try{return String([{toString:first},{toString:last}])}catch(error){return error}", { budget }))
      .toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each([
    "String([{toString:first},{toString:stop}])",
    "String((function(){const error=new Error();error.name={toString:first};error.message={toString:stop};return error})())"
  ])("releases converted text before a caught failure continues: %s", async expression => {
    const budget = new Budget({ dataSize: 6000 });
    const source = `function first(){return 'b'.repeat(2000)}function stop(){throw 'stop'}function next(){const temporary='y'.repeat(5000);throw 'allocated'}try{${expression}}catch(error){}try{next()}catch(error){return error}`;
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
