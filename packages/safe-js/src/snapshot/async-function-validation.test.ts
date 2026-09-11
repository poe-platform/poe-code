import { assert, expect, it } from "vitest";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { SnapshotValidationError } from "./validation.js";

it("rejects an iterator await kind that does not match its adapter", async () => {
  const source = "const c=Promise.withResolvers();const pending=(async()=>{for await(const value of [c.promise])return value})();return ()=>[pending,c.resolve]";
  const result = await run(source);assert(result.ok);
  const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const wire = JSON.parse(JSON.stringify(snapshot));
  const expressions = Object.values(wire.heap as Record<string, {expressionStates?: Record<string, {kind:string;phase:string;awaitState:unknown}>}>)
    .flatMap(node => Object.values(node.expressionStates ?? {}));
  const iteration = expressions.find(state => state.kind === "for-of-iterator" && state.phase === "next");
  assert(iteration);iteration.awaitState = {kind:"result"};
  expect(() => restore(wire,{source})).toThrow(SnapshotValidationError);
});

it.each(["resolver ownership", "future generation", "invalid action", "active phase"])(
  "rejects malformed async continuation %s", async alteration => {
    const source = "const c=Promise.withResolvers();const pending=(async()=>{await c.promise;return 42})();return ()=>[pending,c.resolve]";
    const result = await run(source);
    assert(result.ok);
    const snapshot = serialize({source,currentAstNodeId:1,scopeChain:[{id:"module",bindings:{read:result.returnValue as RuntimeSnapshotValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
    const wire = JSON.parse(JSON.stringify(snapshot));
    const nodes = Object.values(wire.heap as Record<string, Record<string, unknown>>);
    const driver = nodes.find(node => node.kind === "async-function-driver");
    const handler = nodes.find(node => node.kind === "async-function-handler");
    assert(driver && handler);
    if (alteration === "resolver ownership") {
      const capability = driver.capability as Record<string, unknown>;
      capability.resolve = capability.reject;
    } else if (alteration === "future generation") {
      handler.generation = Number(driver.generation) + 1;
    } else if (alteration === "invalid action") {
      handler.action = "return";
    } else {
      driver.phase = "running";
    }
    expect(() => restore(wire, {source})).toThrow(SnapshotValidationError);
  }
);
