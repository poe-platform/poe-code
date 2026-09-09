import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

it.each([
  'class C{f=()=>{try{return eval("arguments")}catch(e){return e.name}}}return new C().f',
  'class C{static f=()=>{try{return eval("arguments")}catch(e){return e.name}}}return C.f',
  'class C{static{this.f=()=>{try{return eval("arguments")}catch(e){return e.name}}}}return C.f',
  'class C{f=async()=>{await 0;try{return eval("arguments")}catch(e){return e.name}}}return new C().f'
])("restores class-initializer eval context: %s", async source => {
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: {f: original.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  expect(Object.values(wire.heap).some(node => node.kind === "guest-function" && node.environment?.classInitializer === true)).toBe(true);
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  const binding = restored.currentScope.lookup("f");
  if (!binding.found) throw new Error("Missing restored function.");
  expect(await interpret(parseModule("{return await f()}").body[0], {
    budget: restored.budget, bindings: {f: binding.value}
  })).toMatchObject({ok: true, returnValue: "SyntaxError"});

  for (const invalid of [false, "yes"]) {
    const forged: typeof wire = JSON.parse(JSON.stringify(wire));
    const fn = Object.values(forged.heap).find(node => node.kind === "guest-function" && node.environment?.classInitializer === true);
    if (fn?.kind !== "guest-function" || fn.environment === undefined) throw new Error("Missing class initializer environment.");
    (fn.environment as Record<string, unknown>).classInitializer = invalid;
    expect(() => restore(forged, {source})).toThrow(SnapshotValidationError);
  }
});
