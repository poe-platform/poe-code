import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { compactAstStatistics } from "./compact-module-ast.js";
import { functionSources, functionStrictness } from "./function-source.js";
import { parseSourceModule } from "./source-module.js";

const pad = `/*${"x".repeat(512)}*/`;

function compile(source: string, compactAst: boolean) {
  const budget = new Budget({ maxSteps: 1000000, dataSize: 1000000 });
  const lease = budget.acquireCompileOwner();
  const options = { sharedPositions: true, compactAst };
  try {
    return {
      parsed: parseSourceModule(source, "entry", lease.owner, options),
      steps: budget.stepsUsed,
      data: budget.currentDataSize
    };
  } finally {
    lease.release();
    expect(budget.currentDataSize).toBe(0);
  }
}

it("keeps cold source-module bodies packed during IDs and top-level await detection", () => {
  const source = `export function cold(){${pad}return [${Array.from({ length: 1000 }, (_, i) => `{value:${i}}`).join(",")}];}`;
  const { parsed } = compile(source, true);
  expect(parsed.hasTLA).toBe(false);
  const stats = compactAstStatistics(parsed.module);
  expect(stats).toBeDefined();
  expect(stats!.materializedRecords).toBeLessThan(30);
  expect(parsed.module.body[0]!.type).toBe("FunctionDeclaration");
  expect(compactAstStatistics(parsed.module)!.materializedRecords).toBeLessThan(30);
});

it.each([
  `import {x} from 'dep';export function f(){${pad}return x};export {x};`,
  `export default function(){${pad}return 1};export * from 'dep';`,
  `export default class {#x=1;read(){${pad}return this.#x}};`,
  `export const f=async()=>{${pad}await 0};`,
  `export class C{[await 0](){${pad}return 1}};`,
  `for await (const x of []) {} export const f=()=>{${pad}return 1};`,
  `await using value=null;export {value};`,
  `export function f(){${pad}return /a[b-c]+/giu};`,
  `const x=1;export {x as 'a-b'};export * as ns from 'dep' with {type:'json'};`
])("preserves source-module syntax, IDs, metadata and metering: %s", (source) => {
  const control = compile(source, false);
  const candidate = compile(source, true);
  expect(candidate.steps).toBe(control.steps);
  expect(candidate.data).toBe(control.data);
  expect(candidate.parsed).toEqual(control.parsed);
  const pending: Array<[unknown, unknown]> = [[control.parsed.module, candidate.parsed.module]];
  while (pending.length) {
    const [first, second] = pending.pop()!;
    if (first === null || typeof first !== "object") continue;
    const node = first as Parameters<typeof functionSources.get>[0];
    const other = second as typeof node;
    expect((other as { nodeId?: number }).nodeId).toBe((node as { nodeId?: number }).nodeId);
    expect(functionSources.get(other)).toEqual(functionSources.get(node));
    expect(functionStrictness.get(other as Parameters<typeof functionStrictness.get>[0])).toBe(
      functionStrictness.get(node as Parameters<typeof functionStrictness.get>[0])
    );
    for (const key of Object.keys(first))
      pending.push([
        (first as Record<string, unknown>)[key],
        (second as Record<string, unknown>)[key]
      ]);
  }
});

it.each([
  `export function f(){${pad}return object.#missing}`,
  `export function f(){${pad}return class {#x=1;#x=2}}`,
  `export const x=1;export {x};`,
  `export {missing};`,
  `export function f(){${pad}return '\\123'}`
])("preserves complete early-error validation: %s", (source) => {
  const outcome = (compact: boolean) => {
    try {
      compile(source, compact);
      return "success";
    } catch (error) {
      return { name: (error as Error).name, message: (error as Error).message };
    }
  };
  expect(outcome(true)).toEqual(outcome(false));
  expect(outcome(true)).not.toBe("success");
});
