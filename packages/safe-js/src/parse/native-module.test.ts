import { expect, it } from "vitest";
import { parseSourceModule } from "./parser.js";

it.each([
  "import 'dep';",
  "import {} from 'dep';",
  "import value, {x as local, 'a-b' as named} from './dep.js'; export {local, named};",
  "import value, * as ns from 'dep'; export {value, ns};",
  "export {}; export {} from 'dep';",
  "export * from 'dep'; export * as 'a-b' from 'dep';",
  "const x=1; export {x as 'a-b'};",
  "export let x=1; export var y; export function f(){}; export class C{};",
  "export async function f(){await 0}; export function* g(){yield 0};",
  "export const {x, y: [z, ...rest]}={};",
  "import 'dep' with {type:'json', 'a-b':'c'};",
  "export {x as y} from 'dep' with {type:'json'};",
  "export default function(){};",
  "export default class {};",
  "export default async function*(){};",
  "export default 1;",
  "export {later}; var later;",
  "export {later}; {var later};",
  "const meta=import /* comment */ . /* comment */ meta;"
])("accepts ECMAScript module syntax: %s", source => {
  expect(() => parseSourceModule(source, "guest.js")).not.toThrow();
});

it.each([
  "export default 1; export default 2;",
  "export {missing};",
  "import {x} from 'dep'; let x;",
  "import {x, x} from 'dep';",
  "import {default} from 'dep';",
  "import {'a-b'} from 'dep';",
  "import 'dep' with {type:'json', type:'json'};",
  "import 'dep' with {type:1};",
  "import 'dep' with {type:'json'} export const x=1;",
  "export {x as 'same', x as same}; const x=1;",
  "export {default};",
  "export * as x;",
  "export const x=1; export {x};",
  "function f(){} function f(){}",
  "function f(){} var f;",
  "var f; function f(){}",
  "{import 'dep'}",
  "return 1;",
  "with({}){}",
  "let await;",
  "function f(){let await;}",
  "const x=010;",
  "const x='\\1';",
  "const x=1 const y=2;",
  "export default 1 export const x=2;",
  "\\u0065xport const x=1;",
  "export d\\u0065fault 0;",
  "import.m\\u0065ta;",
  "switch(0){case 0:using x=null;}",
  "async function f(){switch(0){default:await using x=null;}}"
])("rejects ECMAScript module early errors: %s", source => {
  expect(() => parseSourceModule(source, "guest.js")).toThrow(SyntaxError);
});

it("produces linking metadata and executable nodes in one parse", () => {
  const source = "import value, {x as local} from './dep.js'; export {local as 'a-b'}; export let n=1;";
  const parsed = parseSourceModule(source, "guest.js");
  expect(parsed.imports).toEqual([
    {request: "./dep.js", imported: "default", local: "value"},
    {request: "./dep.js", imported: "x", local: "local"}
  ]);
  expect(parsed.exports).toEqual([{local: "local", exported: "a-b"}, {local: "n", exported: "n"}]);
  expect(parsed.module.body.map(node => node.type)).toEqual(["VariableDeclaration"]);
  expect(parsed.module.body[0]?.span.start.offset).toBe(source.indexOf("let n"));
});

it.each([
  ["await using x=null;", true],
  ["async function f(){await using x=null;}", false],
  ["for await(const x of []){}", true],
  ["const f=async()=>{for await(const x of []){}}", false]
] as const)("detects top-level asynchronous work: %s", (source, expected) => {
  expect(parseSourceModule(source).hasTLA).toBe(expected);
});
