import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreDump } from "../restore.js";
import { validateDumpEnvelope } from "./validation.js";

it.each(['()=>1', 'async function(){}', 'function*(){}', '({m(){}}).m', 'function(){}', 'Function("return 1")', 'eval("()=>1")', '(new class { saved = function(){} }).saved'].flatMap(expression => [false, true].map(bound => [expression, bound] as const)))("rejects forged constructibility for %s with bound=%s", async (expression, bound) => {
  const source = `Number.prototype.saved=new Proxy((${expression})${bound ? '.bind(null).bind(null)' : ''},{});await 0;return 1`;
  const pending = run(source);
  const snapshot = JSON.parse(await dump(pending));
  await pending;
  expect(() => validateDumpEnvelope(snapshot, {source})).not.toThrow();
  expect(() => restoreDump(snapshot, { source })).not.toThrow();
  const proxy = Object.values(snapshot.heap).find(value => (value as {kind:string}).kind === 'guest-proxy') as {constructible:boolean};
  proxy.constructible = !proxy.constructible;
  expect(() => validateDumpEnvelope(snapshot, {source})).toThrow();
  expect(() => restoreDump(snapshot, { source })).toThrow();
});

