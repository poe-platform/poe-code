import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, run } from "../../core.js";

describe("incremental regex splitting", () => {
  it.each([
    "return ('a'+'x'.repeat(25)).split(/a|(x+)+y/,1);",
    "return ('a'+'x'.repeat(25)).split(/(a)|(x+)+y/,2);",
    "return ('a'+'x'.repeat(25)).split(/(a)(z)?|(x+)+y/,3);",
    "const regex=/a|(x+)+y/g;regex.lastIndex=7;return [('a'+'x'.repeat(25)).split(regex,1),regex.lastIndex];",
    "return ('ba'+'x'.repeat(25)).split(/^|a|(x+)+y/,1);",
    "return 'abc'.split(/(?:)/,2);",
    "return ''.split(/(?:)/);",
    "return 'a,b,'.split(/,/);"
  ])("matches native without scanning unused input: %s", async source => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("still enforces regex budgets when the suffix is required", async () => {
    await expect(run("return ('a'+'x'.repeat(25)).split(/a|(x+)+y/,3);")).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("still enforces the result array budget", async () => {
    await expect(run("return 'a,b,c'.split(/,/);", { budget: new Budget({ arrayLength: 2 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  });

  it("checks each result allocation before scanning further", async () => {
    await expect(run("return ('a'+'x'.repeat(25)).split(/a|(x+)+y/,2);", { budget: new Budget({ arrayLength: 0 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  });
});
