import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { parseModule } from "../parse/parser.js";
import { isSandboxPromise, type SandboxClosure, type SandboxGenerator } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";
import { runInNewContext } from "node:vm";

it.each([
  "const sent=count++ + (yield 1);yield [count,sent]",
  "const sent=[count++,yield 1];yield [count,sent]",
  "const sent=[,count++,...[7,8],yield 1];yield [count,sent]",
  "const sent=count++ + (yield 1) + (yield 2);yield [count,sent]",
  "return [count++,yield 1,count++]"
])("preserves intermediate expression values across repeated restores: %s", async body => {
  const source = `{let count=0;function* values(){${body}}const iterator=values();iterator.next();return iterator}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  let iterator = original.returnValue as RuntimeSnapshotValue;
  const native = runInNewContext(`let count=0;function* values(){${body}}const iterator=values();iterator.next();iterator`);
  for (const sent of [4, 5, 6]) {
    const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
      scopeChain: [{ id: "external", bindings: { iterator } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
    const binding = restored.currentScope.lookup("iterator");
    if (!binding.found) throw new Error("Missing restored iterator");
    iterator = binding.value as RuntimeSnapshotValue;
    const next = await interpret(parseModule(`{return iterator.next(${sent})}`).body[0], {
      budget: restored.budget, bindings: { iterator: binding.value }
    });
    expect(next).toMatchObject({ ok: true, returnValue: native.next(sent) });
  }
});

it.each([
  ["start", "", 1, false, 1],
  ["suspended", "iterator.next();", 5, false, 2],
  ["done", "iterator.next();iterator.next(4);iterator.next();", undefined, true, 2]
] as const)("restores a %s generator and its shared effects", async (_state, advance, expected, done, count) => {
  const source = `{let count=0;function* values(){count++;const sent=yield count;count++;yield sent+1}const iterator=values();${advance}return [iterator,()=>count]}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { pair: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("pair");
  if (!binding.found) throw new Error("Missing restored pair");
  const [iterator, read] = binding.value as [SandboxGenerator, SandboxClosure];
  const next = await interpret(parseModule("{return iterator.next(4)}").body[0], {
    budget: restored.budget, bindings: { iterator }
  });
  expect(next).toMatchObject({ ok: true, returnValue: { value: expected, done } });
  expect(await read.call([])).toBe(count);
  const [, originalRead] = original.returnValue as [SandboxGenerator, SandboxClosure];
  expect(await originalRead.call([])).toBe(_state === "start" ? 0 : _state === "suspended" ? 1 : 2);
});

it.each([
  ["function* values(){try{yield 1}finally{yield 9}}", "iterator.return(4)", 9, false],
  ["function* values(){try{yield 1}catch(error){yield error+2}}", "iterator.throw(4)", 6, false],
  ["function* values(){try{}finally{yield 1}yield 2}", "iterator.next(4)", 2, false],
  ["async function* values(){const sent=yield 1;yield sent+2}", "iterator.next(4)", 6, false]
] as const)("restores completion delivery for %s", async (definition, operation, value, done) => {
  const source = `{${definition}const iterator=values();await iterator.next();return iterator}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing restored iterator");
  const next = await interpret(parseModule(`{return ${operation}}`).body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  });
  if (!next.ok) throw new Error(next.error.message);
  const result = next.returnValue;
  expect(isSandboxPromise(result) ? await result.promise : result).toEqual({ value, done });
  const recaptured = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: binding.value as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const generator = Object.values(recaptured.heap!).find(node => node.kind === "guest-generator")!;
  expect(generator.sent).toHaveLength(2);
  expect(generator.sent[1]).toEqual({ type: operation.includes(".return") ? "return" : operation.includes(".throw") ? "throw" : "normal", value: 4 });
  expect(() => restore(JSON.parse(JSON.stringify(recaptured)), { source })).not.toThrow();
});

it("restores nested lexical scopes without leaking a shadowed binding after the block", async () => {
  const source = "{function* values(){let value=2;{let value=7;yield value;}yield value}const iterator=values();iterator.next();return iterator}";
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing restored iterator");
  const next = await interpret(parseModule("{return iterator.next()}").body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  });
  expect(next).toMatchObject({ ok: true, returnValue: { value: 2, done: false } });
});

it.each([
  "const sent=(count++,yield 1);yield count+sent",
  "try{count++;const sent=yield 1;yield count+sent}finally{}",
  "try{count++;throw 0}catch(error){const sent=yield 1;yield count+sent}",
  "try{count++}finally{const sent=yield 1;yield count+sent}",
  "try{count++;throw 1}catch(error){error+=3;const sent=yield 1;yield count+sent+(error-4)}"
])("does not repeat evaluated effects before suspension: %s", async body => {
const source = `{let count=0;function* values(){${body}}const iterator=values();iterator.next();return iterator}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { iterator: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("iterator");
  if (!binding.found) throw new Error("Missing restored iterator");
  const next = await interpret(parseModule("{return iterator.next(4)}").body[0], {
    budget: restored.budget, bindings: { iterator: binding.value }
  });
  expect(next).toMatchObject({ ok: true, returnValue: { value: 5, done: false } });
});

it.each([
  ["try{count++;return 17}finally{yield 1}", { value: 17, done: true }],
  ["try{count++;throw 17}finally{yield 1}", { thrown: 17 }],
  ["outer:{try{count++;break outer}finally{yield 1}count+=10}return 17", { value: 17, done: true }],
  ["while(count<1){try{count++;continue}finally{yield 1}}return 17", { value: 17, done: true }],
  ["try{count++;return 17}finally{try{return 23}finally{yield 1}}", { value: 23, done: true }]
] as const)("preserves pending completion through finally: %s", async (body, expected) => {
  const source = `{let count=0;function* values(){${body}}const iterator=values();iterator.next();return [iterator,()=>count]}`;
  const ast = parseModule(source);
  const original = await interpret(ast.body[0]);
  if (!original.ok) throw new Error(original.error.message);
  const snapshot = serialize({ source, currentAstNodeId: ast.body[0].nodeId!,
    scopeChain: [{ id: "external", bindings: { pair: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const restored = restore(JSON.parse(JSON.stringify(snapshot)), { source });
  const binding = restored.currentScope.lookup("pair");
  if (!binding.found) throw new Error("Missing restored pair");
  const [iterator, read] = binding.value as [SandboxGenerator, SandboxClosure];
  const next = await interpret(parseModule("{try{return iterator.next()}catch(error){return {thrown:error}}}").body[0], {
    budget: restored.budget, bindings: { iterator }
  });
  expect(next).toMatchObject({ ok: true, returnValue: expected });
  expect(await read.call([])).toBe(1);
});
