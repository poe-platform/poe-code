import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { parse } from "./parser.js";

it.each([
  "new tag`first`",
  "new tag`first`(7)",
  "new tag`first${(log.push('substitution'),2)}`((log.push('argument'),7))",
  "new holder.tag`first`(7)",
  "new holder['tag']`first`(7)",
  "new (tag`first`)(7)",
  "(new tag)`first`",
  "new arrow`first`(7)",
  "new returningObject`first`.C(7)",
  "new returningObject`first`['C'](7)",
  "new chained`first``second`(7)"
])("preserves tagged-template constructor precedence: %s", async expression => {
  const source = `const log=[];
    function C(value){log.push(['construct',new.target===C,value]);this.value=value}
    function tag(parts,...values){log.push(['tag',parts===undefined?undefined:Array.from(parts.raw),values,this===holder]);return C}
    const holder={tag};const arrow=(parts)=>tag(parts);const returningObject=parts=>({C:tag(parts)});
    const chained=parts=>{tag(parts);return tag};let result;
    try{const value=${expression};result=[value instanceof C,value.value]}catch(error){result=error.name}
    return [result,log]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{'use strict';" + source + "})()") });
});

it.each(["return 1", "throw 'tag failure'"])("preserves tag and argument effects before constructor failure: %s", body => {
  const source = `const log=[];const tag=parts=>{log.push('tag');${body}};try{new tag\`a\${(log.push('substitution'),1)}\`((log.push('argument'),2))}catch(e){log.push(typeof e==='string'?e:e.name)}return log`;
  const expected = runInNewContext("(()=>{'use strict';" + source + "})()");
  return expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
});

it("allows malformed cooked escapes in a constructor tag", async () => {
  const source = "let cooked,raw;class C{};const tag=parts=>{cooked=parts[0];raw=parts.raw[0];return C};const value=new tag`\\xZ`;return [value instanceof C,cooked,raw]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
});

it("preserves yield expressions in constructor-tag substitutions", async () => {
  const source = "let substitution;class C{constructor(value){this.value=value}};const tag=(parts,value)=>{substitution=value;return C};function* make(){return new tag`a${yield 'pause'}`(7)}const gen=make();const first=gen.next();const last=gen.next('sent');return [first,last.done,last.value instanceof C,last.value.value,substitution]";
  expect(await run(source)).toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
});

it("constructs the tag result in the syntax tree", () => {
  expect(parse("new tag`text`(7)")).toMatchObject({
    type: "NewExpression",
    callee: { type: "TaggedTemplateExpression", tag: { type: "Identifier", name: "tag" } },
    arguments: [{ type: "NumericLiteral", value: 7 }],
    span: { start: { offset: 0 }, end: { offset: 16 } }
  });
});

it("keeps completed tag/substitution effects through replay", async () => {
  const source = "let tags=0;class C{constructor(value){this.value=value}};const tag=parts=>{tags++;return C};const value=new tag`a${input()}`(7);await 0;return [value instanceof C,value.value,tags]";
  let calls = 0;
  const bindings = { input() { calls++; return "x"; } };
  const first = await run(source, { bindings });
  expect(first).toMatchObject({ ok: true, returnValue: [true, 7, 1] });
  expect(await run(source, { bindings, snapshot: JSON.parse(await dump(first)) })).toMatchObject({ ok: true, returnValue: first.returnValue });
  expect(calls).toBe(1);
});
