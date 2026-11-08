import { expect, it } from "vitest";
import { run } from "../run.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it.each([
  "Promise.resolve().then(()=>missing)",
  "(async()=>missing)()",
  "new Promise(()=>missing)",
  "Promise.resolve().then(async()=>missing)",
  "Promise.resolve().finally(()=>missing)",
  "Promise.try(()=>missing)",
  "Promise.resolve({then(){missing}})",
  "Promise.resolve({get then(){return missing}})",
  "Promise.resolve().then(()=>missing).then()"
])("restores a source-reference rejection as a ReferenceError instance: %s", async producer => {
  const source = `{const p=${producer};await p.catch(()=>0);return {p,ReferenceError}}`;
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: original.returnValue as Record<string, RuntimeSnapshotValue>}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  const binding = restored.currentScope.lookup("p");
  if (!binding.found) throw new Error("Missing restored promise.");
  expect(await interpret(parseModule('{const first=await p.catch(e=>e);return await p.catch(e=>[e.name,e instanceof ReferenceError,e===first])}').body[0], {
    budget: restored.budget, bindings: {p: binding.value, ReferenceError: restored.currentScope.lookup("ReferenceError").value}
  })).toMatchObject({ok: true, returnValue: ["ReferenceError", true, true]});
});

it("preserves a guest-thrown diagnostic look-alike and its identity after restore", async () => {
  const source = `{const reason={code:"UNBOUND_IDENTIFIER",name:"ReferenceError",message:"guest",span:{}};
    const p=Promise.resolve().then(()=>{throw reason});await p.catch(()=>0);return {p,reason,ReferenceError}}`;
  const original = await run(source);
  if (!original.ok) throw new Error(original.error.message);
  const wire = serialize({source, currentAstNodeId: parseModule(source).body[0].nodeId!,
    scopeChain: [{id: "external", bindings: original.returnValue as Record<string, RuntimeSnapshotValue>}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source});
  expect(await interpret(parseModule('{return await p.catch(e=>[e===reason,e instanceof ReferenceError])}').body[0], {
    budget: restored.budget, bindings: {
      p: restored.currentScope.lookup("p").value,
      reason: restored.currentScope.lookup("reason").value,
      ReferenceError: restored.currentScope.lookup("ReferenceError").value
    }
  })).toMatchObject({ok: true, returnValue: [true, false]});
});
