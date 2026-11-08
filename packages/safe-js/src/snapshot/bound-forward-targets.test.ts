import { expect, it } from "vitest";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { validateDumpEnvelope } from "./validation.js";
import { boundFunctionStates } from "../interp/bound-function-state.js";
import type { SandboxClosure } from "../interp/values.js";

it("restores 4096 forward bound targets with receiver and argument back references", () => {
  const source = 'return fn()';
  const snapshot = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1,
    scopeChain: [{id:'module',bindings:{fn:{kind:'ref',id:1}}}], callStack:[],pendingPromises:[],moduleBindings:{} })));
  const state = {properties:{properties:[],extensible:true}};
  snapshot.heap = {'4097':{kind:'guest-proxy-revoker',proxy:null,state}};
  for (let id = 1; id <= 4096; id++) snapshot.heap[id] = {kind:'bound-function',target:{kind:'ref',id:id+1},
    thisValue:{kind:'ref',id:1},args:[{kind:'ref',id:1}],length:0,state};
  snapshot.scopeChain[0].bindings.fn = {kind:'ref',id:1};
  expect(() => validateDumpEnvelope({...snapshot,version:2})).not.toThrow();
  const restored = restore(snapshot,{source});
  const outer = restored.currentScope.lookup('fn').value as SandboxClosure;
  let current = outer;
  for (let id = 1; id <= 4096; id++) {
    const bound = boundFunctionStates.get(current)!;
    expect(bound.thisValue).toBe(outer);
    expect(bound.args).toEqual([outer]);
    current = bound.target;
  }
  expect(boundFunctionStates.has(current)).toBe(false);
});

