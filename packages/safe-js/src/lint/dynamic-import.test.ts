import { expect, it } from "vitest";
import { lint } from "./index.js";
import { AS_JSDOC_TYPE } from "./rules/AS-jsdoc-type.js";

const nestedCases = [
  ["Unknown.x;", "AS003"],
  ["const never=7;", "AS007"],
  ["Promise.race([Promise.resolve(7)]);", "AS015"],
  ["Object.freeze([1]).push(2);", "AS-MUTATING-FROZEN"],
  ["const {a=1}={a:null};", "AS-DESTRUCTURE-NULL-DEFAULT"],
  ["const String=7;", "AS-SHADOW-GLOBAL"],
  ['return "fixture";1;', "AS-UNREACHABLE"],
  ["while(true){}", "AS-UNBOUNDED-LOOP"],
  ["const x=7;`${x}`;", "AS-NEEDLESS-TEMPLATE"],
  ["[1,2,3,4];", "AS-LARGE-LITERAL"],
  ["const f=async()=>7;f;", "AS-ASYNC-NOT-NEEDED"],
  ["const f=()=>await value;f;", "AS-MISSING-ASYNC"],
  ["Promise.resolve(7);", "AS-FLOATING-PROMISE"],
  ['import.meta.url="next";', "AS-IMPORT-META-ASSIGN"]
] as const;

for (const position of ["source","options"] as const) {
  it.each(nestedCases)(`preserves %s diagnostics in import ${position}`, (body,code) => {
    const expression=`(()=>{${body};return "fixture";})()`;
    const baseline=lint(expression,{largeLiteralThreshold:3}).map(diagnostic=>diagnostic.code);
    expect(baseline).toContain(code);
    const source=position==="source" ? `await import(${expression})` : `await import("fixture",${expression})`;
    expect(lint(source,{largeLiteralThreshold:3}).map(diagnostic=>diagnostic.code)).toEqual(baseline);
  });

  it(`checks JSDoc annotations inside import ${position}`, () => {
    const expression='(()=>{/** @type {string} */ const value=7;return value;})()';
    const source=position==="source" ? `await import(${expression})` : `await import("fixture",${expression})`;
    const scan=(value:string)=>AS_JSDOC_TYPE(value,{filename:"probe.ajs",modules:{current:{exports:{default:"unknown"},filename:"probe.ajs",source:value}}});
    expect(scan(expression).map(diagnostic=>diagnostic.code)).toContain("AS-JSDOC-TYPE");
    expect(scan(source).map(diagnostic=>diagnostic.code)).toContain("AS-JSDOC-TYPE");
  });
}

it.each([
  'const key="fixture";await import(key);',
  'const options={};await import("fixture",options);',
  'import {key} from "fixture";await import(key);',
  'import {read} from "fixture";let key=read();await import(key);'
])("counts values read by dynamic imports: %s", source => {
  expect(lint(source,{modules:{fixture:["key","read"]}})).toEqual([]);
});

it("counts frontmatter fields read by dynamic imports", () => {
  expect(lint("export default frontmatter=>import(frontmatter.path)", {frontmatterFields:["path"]})).toEqual([]);
});

it.each(["source","options"])("checks returned host calls inside the import %s", position => {
  const expression="(async()=>read())()";
  const prefix='import {read} from "fixture";';
  const source=position==="source" ? `${prefix}await import(${expression})` : `${prefix}await import("fixture",${expression})`;
  expect(lint(`${prefix}${expression}`).map(diagnostic=>diagnostic.code)).toContain("AS009");
  expect(lint(source).map(diagnostic=>diagnostic.code)).toContain("AS009");
});

it("reports a discarded dynamic import promise", () => {
  expect(lint('import("fixture")').map(diagnostic=>diagnostic.code)).toEqual(["AS-FLOATING-PROMISE"]);
});

it.each(['await import("fixture")','return import("fixture")','const pending=import("fixture");return pending','import("fixture").then(value=>value)'])("accepts a consumed import promise: %s", source => {
  expect(lint(source)).toEqual([]);
});
