import { assert, expect, it } from "vitest";
import { run } from "../src/run.js";
import { Budget } from "../src/interp/budget.js";
import { invokeBuiltinClosure } from "../src/interp/builtin-call.js";
import { awaitSandboxValue } from "../src/interp/cancel.js";
import { isSandboxClosure } from "../src/interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "../src/snapshot/serialize.js";
import { restore } from "../src/snapshot/restore.js";

const source = `let finish;let reads=0;
  const value={get then(){reads++;if(reads===2)return resolve=>{finish=resolve}}};
  const delegate={[Symbol.asyncIterator](){return this},next(){return {done:false}}};
  async function* f(){yield* delegate}
  const g=f();await g.next();const last=g.return(value);
  await 0;await 0;
  return async()=>{finish(7);return [(await last).value,reads]};`;

it("restores a pending absent-delegate-return Await without repeating its getter", async () => {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
  expect(await (await new AsyncFunction(source)())()).toEqual([7, 2]);
  for (const restorePending of [false, true]) {
    const result = await run(source);
    assert(result.ok && isSandboxClosure(result.returnValue));
    const budget = new Budget();
    let read = result.returnValue;
    if (restorePending) {
      const snapshot = serialize({
        source,
        currentAstNodeId: 1,
        scopeChain: [{ id: "module", bindings: { read: read as RuntimeSnapshotValue } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });
      const frame = Object.values(snapshot.heap!).find(
        (node) =>
          node.kind === "guest-generator" &&
          Object.values(node.expressionStates ?? {}).some(
            (expression) => expression.kind === "yield-delegate" && expression.phase === "return"
          )
      );
      expect(frame).toBeDefined();
      const binding = restore(JSON.parse(JSON.stringify(snapshot)), {
        source,
        budget
      }).currentScope.lookup("read");
      assert(binding.found && isSandboxClosure(binding.value));
      read = binding.value;
    }
    expect(
      await awaitSandboxValue(
        await invokeBuiltinClosure(read, [], budget, undefined, undefined),
        undefined,
        budget
      )
    ).toEqual([7, 2]);
  }
});

it.each(["wrong-completion", "iterator-await-state"])(
  "rejects malformed delegated return state: %s",
  async (corruption) => {
    const result = await run(source);
    assert(result.ok);
    const snapshot = serialize({
      source,
      currentAstNodeId: 1,
      scopeChain: [
        { id: "module", bindings: { read: result.returnValue as RuntimeSnapshotValue } }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const wire = JSON.parse(JSON.stringify(snapshot));
    let changed = false;
    for (const node of Object.values(wire.heap) as Array<{
      kind: string;
      expressionStates?: Record<
        string,
        { kind: string; phase?: string; completion: { type: string }; awaitState?: unknown }
      >;
    }>) {
      for (const expression of Object.values(node.expressionStates ?? {})) {
        if (expression.kind === "yield-delegate" && expression.phase === "return") {
          if (corruption === "wrong-completion") expression.completion.type = "normal";
          else expression.awaitState = { kind: "result" };
          changed = true;
        }
      }
    }
    expect(changed).toBe(true);
    expect(() => restore(wire, { source })).toThrow();
  }
);
