import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { parse } from "./parser.js";

const targets = [
  "[][0]",
  "[holder][0].x",
  "{nested:holder}.nested.x",
  "[()=>holder][0]().x",
  "{make(){return holder}}.make().x",
  "[holder].at(0).x",
  "[holder]['0']['x']",
  "([])[0]"
];
it.each(targets.flatMap((target) => ["in", "of"].map((operator) => ({ target, operator }))))(
  "parses literal member loop targets: $target $operator",
  async ({ target, operator }) => {
    const source = `const log=[];const holder={set x(v){log.push(v)}};
      for (${target} ${operator} ${operator === "in" ? "{a:1,b:2}" : '["a","b"]'})log.push('body');return log;`;
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: runInNewContext("(()=>{'use strict';" + source + "})()")
    });
  }
);

it.each([
  "[[][0]] = [1]",
  "({x:[][0]} = {x:1})",
  "[[holder][0].x] = [7]",
  "({x:{nested:holder}.nested.x} = {x:7})",
  "[...[holder][0].x] = [1,2]",
  "[holder.x=7] = []",
  "({x:holder.x=7} = {})"
])("parses nested literal member assignment targets: %s", async (expression) => {
  const source = `const log=[];const holder={set x(v){log.push(v)}};${expression};return log;`;
  expect(await run(source)).toMatchObject({
    ok: true,
    returnValue: runInNewContext("(()=>{'use strict';" + source + "})()")
  });
});

it.each(["for ([]?.x in {}) {}", "for ([{}]?.[0].x in {}) {}", "[...[][0],x]=[]", "({x=1}.x = 2)"])(
  "keeps invalid literal targets rejected: %s",
  (source) => {
    expect(() => runInNewContext("(()=>{'use strict';" + source + "})()")).toThrow();
    expect(() => parse(source)).toThrow();
  }
);
