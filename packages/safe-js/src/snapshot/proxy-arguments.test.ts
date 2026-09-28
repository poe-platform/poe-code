import { expect, it } from "vitest";
import { createSandboxArguments } from "../interp/arguments.js";
import { createGuestProxy, guestProxyStates } from "../interp/guest-proxy.js";
import { restore as restoreDump } from "../restore.js";
import { validateDumpEnvelope } from "./validation.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each(['target', 'handler'] as const)("accepts an arguments object as a Proxy %s", edge => {
  const source = 'return 1';
  const args = createSandboxArguments([1]);
  const proxy = createGuestProxy(edge === 'target' ? args : {}, edge === 'handler' ? args : {});
  const snapshot = JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,
    scopeChain:[{id:'module',bindings:{proxy,args}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  snapshot.version = 2;
  expect(() => validateDumpEnvelope(snapshot, {source})).not.toThrow();
  expect(() => restoreDump(snapshot, {source})).not.toThrow();
  const result = restore(snapshot,{source});
  const restoredProxy = result.currentScope.lookup('proxy').value as object;
  expect(guestProxyStates.get(restoredProxy)?.[edge]).toBe(result.currentScope.lookup('args').value);
});
