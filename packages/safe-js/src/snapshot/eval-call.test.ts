import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore as restoreRuntime } from "./restore.js";

it.each(["eval", "(eval)", "(0,eval)", "eval?.", "other"])(
  "preserves direct versus indirect eval after suspended arguments: %s", async callee => {
    const source = `globalThis.x=9;const other=eval;
      function* values(){let x=7;return ${callee}(yield 0)}
      const iterator=values();iterator.next();await 0;
      return iterator.next("x").value;`;
    const expected: unknown = await runInNewContext(`(async function(){'use strict';${source}})()`);
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = JSON.parse(await dump(pending));
      expect(await completed).toMatchObject({ok: true, returnValue: expected});
      expect(await run(source, {snapshot: restore(snapshot, {source})}))
        .toMatchObject({ok: true, returnValue: expected});
    } finally {await completed;}
  }
);

it.each(["eval", "(eval)", "(0,eval)", "eval?.", "other"])(
  "restores the suspended generator itself before completing %s arguments", async callee => {
    const source = `{globalThis.x=9;const other=eval;
      function* values(){let x=7;return ${callee}(yield 0)}
      const iterator=values();iterator.next();return iterator;}`;
    const native = runInNewContext(`(function(){'use strict';${source}})()`);
    const original = await run(source);
    if (!original.ok) throw new Error(original.error.message);
    const wire = serialize({source, currentAstNodeId: parseModule(source).body[0].nodeId!,
      scopeChain: [{id: "external", bindings: {iterator: original.returnValue as RuntimeSnapshotValue}}],
      callStack: [], pendingPromises: [], moduleBindings: {}});
    const generator = Object.values(wire.heap).find(node => node.kind === "guest-generator");
    if (generator?.kind !== "guest-generator") throw new Error("Missing generator state.");
    expect(Object.values(generator.expressionStates ?? {}).some(state => state.kind === "call")).toBe(true);
    const restored = restoreRuntime(JSON.parse(JSON.stringify(wire)), {source});
    const binding = restored.currentScope.lookup("iterator");
    if (!binding.found) throw new Error("Missing restored iterator.");
    expect(await interpret(parseModule('{return iterator.next("x")}').body[0], {
      budget: restored.budget, bindings: {iterator: binding.value}
    })).toMatchObject({ok: true, returnValue: native.next("x")});
  }
);
