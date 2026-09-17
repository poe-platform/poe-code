import { expect, it } from "vitest";
import { parseSourceModule } from "./source-module.js";
import { Budget } from "../interp/budget.js";

it("parses source-module exports and requests without executing them", () => {
  const parsed = parseSourceModule(`import { x as local } from 'dep';
    export let count = 0; export function inc(){count++}
    export { local as value }; export { y as indirect } from 'dep';
    export * from 'star'; export * as ns from 'star'; export default 7;`, "entry");
  expect(parsed.requests).toEqual(["dep", "star"]);
  expect(parsed.imports).toEqual([{ request: "dep", imported: "x", local: "local" }]);
  expect(parsed.exports).toEqual([
    { exported: "count", local: "count" }, { exported: "inc", local: "inc" },
    { exported: "value", local: "local" }, { exported: "indirect", request: "dep", imported: "y" },
    { request: "star" }, { exported: "ns", request: "star", imported: "*", namespace:true },
    { exported: "default", local: "default" }
  ]);
  expect(parsed.module.body.map(node => node.type)).toEqual([
    "VariableDeclaration", "FunctionDeclaration", "ExportDefaultDeclaration"
  ]);
});

it.each([
  "export default 1; export default 2", "export {missing}",
  "import {x} from 'dep'; let x", "return 1", "with({}){}",
  "export const x=1; export { x }", "export const {'x': x}=1; export {x}"
])("rejects module early errors: %s", source => {
  expect(() => parseSourceModule(source, "entry")).toThrow(SyntaxError);
});

it.each(["import 'dep' with {type:'json'}", "export * from 'dep' with {type:'json'}"])(
  "preserves attributes for host support checks during loading: %s", source => {
    expect(parseSourceModule(source, "entry").moduleRequests).toEqual([
      {specifier: "dep", attributes: [["type", "json"]]}
    ]);
  }
);

it("accepts an empty attribute set and arbitrary export names", () => {
  const parsed = parseSourceModule("const x=1; export {x as 'a-b'}; import 'dep' with {};", "entry");
  expect(parsed.exports).toEqual([{ exported: "a-b", local: "x" }]);
  expect(parsed.requests).toEqual(["dep"]);
});

it("meters source before parsing", () => {
  const budget = new Budget({maxSteps: 20});
  const lease = budget.acquireCompileOwner();
  try {
    expect(() => parseSourceModule(";".repeat(50), "entry", lease.owner))
      .toThrow(expect.objectContaining({code:"budgetExceeded", budget:"steps"}));
  } finally { lease.release(); }
});

it.each([
  ["await 0",true], ["async function f(){await 0}",false],
  ["class C{[await 0](){}}",true], ["const f=async()=>await 0",false]
] as const)("detects module-level await in %s",(source,expected)=>{
  expect(parseSourceModule(source,"entry").hasTLA).toBe(expected);
});
