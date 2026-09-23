import { afterEach, expect, it, vi } from "vitest";
import { Budget } from "../interp/budget.js";
import { interpret } from "../interp/interpreter.js";
import { Scope } from "../interp/scope.js";
import { parseSourceModule } from "../parse/source-module.js";
import * as asyncInterpreter from "../interp/async.js";
import { measureSandboxData } from "../interp/values.js";
import { CompileScope } from "../interp/regex/compile-guard.js";
import { createBuiltinBindings } from "../interp/globals.js";
import { createModuleEnvironment } from "./registry.js";
import { SourceModuleGraph } from "./source-graph.js";

afterEach(() => vi.restoreAllMocks());

it.each(["ordinary", "source-reference"] as const)(
  "keeps %s function hoisting eager",
  async (mode) => {
    const { module } = parseSourceModule("function eager(){return 1}");
    const create = vi.spyOn(asyncInterpreter, "createInterpretedClosure");
    const result = await interpret(
      { type: "BlockStatement", body: module.body, span: module.span },
      {
        scope: new Scope(),
        budget: new Budget(),
        useScopeDirectly: true,
        captureSnapshot: false,
        ...(mode === "source-reference"
          ? { modulePhase: "link" as const, sourceReference: { referrer: "entry" } }
          : {})
      }
    );
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  }
);

it("does not create unused ordinary functions while linking a source module", async () => {
  const budget = new Budget();
  const scope = new Scope();
  const { module } = parseSourceModule("function unused(){return 1} function used(){return 2}");
  const create = vi.spyOn(asyncInterpreter, "createInterpretedClosure");
  const result = await interpret(
    { type: "BlockStatement", body: module.body, span: module.span },
    {
      scope,
      budget,
      useScopeDirectly: true,
      modulePhase: "link",
      captureSnapshot: false
    }
  );
  expect(result.ok).toBe(true);
  expect(create.mock.calls.length).toBe(0);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(2);
  const first = scope.lookup("used");
  expect(first.found).toBe(true);
  expect(create.mock.calls.length).toBe(1);
  expect(scope.lookup("used")).toEqual(first);
  expect(create.mock.calls.length).toBe(1);
  expect(measureSandboxData(scope.retainedDataRoots())).toBe(2);
});

it.each([
  ["export default function named(a,b=1){return a+b}", "named", 1],
  ["export default function(a,b){return a+b}", "default", 2],
  ["export default async function(a){return a+1}", "default", 1]
])("preserves default function behavior for %s", async (source, name, length) => {
  const budget = new Budget();
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const scope = new Scope(createBuiltinBindings({ budget, compileOwner: lease.owner }));
  const moduleSource = `${source};
      import f from 'entry';export const same=f===f;export const name=f.name;
      export const length=f.length;export const result=await f(2,1);`;
  const graph = new SourceModuleGraph({
    resolver: () => ({ id: "entry", source: moduleSource }),
    scope,
    budget,
    compilation,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner })
  });
  try {
    const namespace = await graph.import("entry", "<host>");
    expect(namespace.same).toBe(true);
    expect(namespace.name).toBe(name);
    expect(namespace.length).toBe(length);
    expect(namespace.result).toBe(3);
  } finally {
    graph.close();
    compilation.dispose();
    lease.release();
  }
});

it("preserves constructor prototypes and live overwrites after materialization", async () => {
  const budget = new Budget();
  const lease = budget.acquireCompileOwner();
  const compilation = new CompileScope(lease.owner);
  const scope = new Scope(createBuiltinBindings({ budget, compileOwner: lease.owner }));
  const moduleSource = `
      export function F(x){this.x=x}import {F as alias} from 'entry';
      const old=F;F.prototype.y=7;const instance=new F(3);
      export const value=instance.x+instance.y;
      export const instanceMatches=instance instanceof old;
      F=()=>9;export const overwritten=alias();export const changed=alias!==old;`;
  const graph = new SourceModuleGraph({
    resolver: () => ({ id: "entry", source: moduleSource }),
    scope,
    budget,
    compilation,
    modules: createModuleEnvironment(undefined, { budget, compileOwner: lease.owner })
  });
  try {
    const namespace = await graph.import("entry", "<host>");
    expect(namespace.value).toBe(10);
    expect(namespace.instanceMatches).toBe(true);
    expect(namespace.overwritten).toBe(9);
    expect(namespace.changed).toBe(true);
  } finally {
    graph.close();
    compilation.dispose();
    lease.release();
  }
});

it.each(["function* eager(){yield 1}", "async function* eager(){yield 1}"])(
  "keeps generator linking eager for %s",
  async (source) => {
    const { module } = parseSourceModule(source);
    const create = vi.spyOn(asyncInterpreter, "createInterpretedClosure");
    const result = await interpret(
      { type: "BlockStatement", body: module.body, span: module.span },
      {
        scope: new Scope(),
        budget: new Budget(),
        useScopeDirectly: true,
        modulePhase: "link",
        captureSnapshot: false
      }
    );
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  }
);
