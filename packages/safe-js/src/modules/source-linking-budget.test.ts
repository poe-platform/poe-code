import {expect, it} from "vitest";
import {Budget} from "../interp/budget.js";
import {run} from "../run.js";
import {Scope} from "../interp/scope.js";
import {createModuleEnvironment} from "./registry.js";
import {SourceModuleGraph} from "./source-graph.js";

it("bounds repeated star-export resolution before executing guest code", async () => {
  const budget = new Budget({maxSteps: 100});
  let executed = false;
  const sources: Record<string, string> = {leaf: "export const value=1"};
  for (let index=0; index<14; index++) {
    const next = index === 13 ? ["leaf"] : [`a${index+1}`, `b${index+1}`];
    const source = next.map(id => `export * from '${id}';`).join("");
    sources[`a${index}`] = source;
    sources[`b${index}`] = source;
  }
  // No compile owner: this isolates the graph's work from parser metering.
  const graph = new SourceModuleGraph({budget, scope: new Scope(),
    modules: createModuleEnvironment(undefined, {budget}),
    resolver: id => ({id, source: sources[id]!})});
  try {
    await expect(graph.evaluateSource({id: "entry", source: "import {value} from 'a0';export {value}"},
      () => {executed=true;})).rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
    expect(executed).toBe(false);
  } finally {graph.close();}
});

it("creates a distinct ordinary null-prototype import.meta for each source identity", async () => {
  expect(await run(`
    import {meta as dependency} from 'dep';
    const meta = import.meta;
    const initial = Object.getPrototypeOf(meta) === null;
    const same = meta === import.meta;
    const distinct = meta !== dependency;
    meta.value = 7;
    const descriptor = Object.getOwnPropertyDescriptor(meta, 'value');
    const ordinary = descriptor.value === 7 && descriptor.writable && descriptor.enumerable && descriptor.configurable;
    Object.setPrototypeOf(meta, {inherited: 9});
    export const result = initial && same && distinct && ordinary && import.meta.inherited === 9;
  `, {sourceType: "module", sourceResolver: () => ({id: "dep", source: "export const meta=import.meta"})}))
    .toMatchObject({ok: true, returnValue: {result: true}});
});

it.each(["named", "star"])("bounds recursive %s re-export linking before host stack exhaustion", async mode => {
  const budget = new Budget({maxCallDepth: 10});
  await expect(run(mode === "named" ? "import {value} from '0';export {value}" : "export * from '0'", {
    sourceType: "module", budget,
    sourceResolver: id => ({id, source: Number(id) === 30 ? "export const value=1"
      : mode === "named" ? `export {value} from '${Number(id)+1}'` : `export * from '${Number(id)+1}'`})
  })).rejects.toMatchObject({code: "budgetExceeded", budget: "callDepth"});
  expect(budget.currentCallDepth).toBe(0);
});

it("keeps a caught dynamic linking limit fatal", async () => {
  const budget = new Budget({maxCallDepth: 10});
  await expect(run("try {await import('0')} catch {} export const survived=true", {
    sourceType: "module", budget,
    sourceResolver: id => ({id, source: Number(id) === 30 ? "export const value=1"
      : `export {value} from '${Number(id)+1}'`})
  })).rejects.toMatchObject({code: "budgetExceeded", budget: "callDepth"});
  expect(budget.currentCallDepth).toBe(0);
});

it("resolves converging star paths within the existing step budget", async () => {
  const sources: Record<string, string> = {leaf: "export const value=1"};
  for (let index=0; index<14; index++) {
    const next = index === 13 ? ["leaf"] : [`a${index+1}`, `b${index+1}`];
    const source = next.map(id => `export * from '${id}';`).join("");
    sources[`a${index}`] = source;
    sources[`b${index}`] = source;
  }
  expect(await run("import {value} from 'a0';export {value}", {
    sourceType: "module", budget: new Budget({maxSteps: 30_000}),
    sourceResolver: id => ({id, source: sources[id]!})
  })).toMatchObject({ok: true, returnValue: {value: 1}});
});
