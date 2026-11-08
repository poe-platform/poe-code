import test from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry } from "./command.js";

for (const reverse of [false, true]) test(`dedicated definitions take precedence over fallbacks (reverse=${reverse})`, () => {
  const fallback = { name: "example", fallback: true, execute: () => ({ exitCode: 1 }) };
  const dedicated = { name: "example", execute: () => ({ exitCode: 2 }) };
  const registry = new CommandRegistry(reverse ? [dedicated, fallback] : [fallback, dedicated]);
  assert.equal(registry.get("example")?.execute, dedicated.execute);
  assert.throws(() => registry.register(dedicated), /already registered/);
  registry.register(fallback, { replace: true });
  assert.equal(registry.get("example")?.execute, fallback.execute);
  assert.throws(() => registry.register(fallback), /already registered/);
});
