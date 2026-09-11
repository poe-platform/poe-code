import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "for(var x in null) let\n{}",
  "for(var x in null) let\nx=1",
  "for(var x of []) let\n{}",
  "for(;false;) let\nx=1",
  "while(false) let\n{}",
  "if(false) let\nx=1",
  "if(true) let\n{}",
  "label: let\n{}",
  "label: let\nx=1",
  "with({}) let\nx=1",
  "var n=0;do let\nwhile(n++===0)",
  "let\n{z}={z:3}",
  "let\ny=3"
])("parses sloppy let according to statement context: %s", async (statement) => {
  const source = `var let=7,x=0;${statement};return [x,typeof y];`;
  const expected = runInNewContext("Function(" + JSON.stringify(source) + ")()");
  expect(await run("return Function(" + JSON.stringify(source) + ")()")).toMatchObject({
    ok: true,
    returnValue: expected
  });
});

it.each([
  "for(var x in null) let\n[a]=[]",
  "if(false) let x=1",
  "label: let x=1",
  "label: let\n[a]=[]",
  "for(var x in null) const x=1",
  "'use strict';for(var x in null) let\n{}",
  "'use strict';label: let\nx=1"
])("keeps prohibited declarations and strict let rejected: %s", async (source) => {
  expect(() => runInNewContext("Function(" + JSON.stringify(source) + ")")).toThrow();
  expect(
    await run(
      "try{Function(" +
        JSON.stringify(source) +
        ");return 'accepted'}catch(error){return error.name}"
    )
  ).toMatchObject({ ok: true, returnValue: "SyntaxError" });
});
