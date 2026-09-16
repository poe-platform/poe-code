import assert from "node:assert/strict";
import test from "node:test";
import { commandRuntimeIdentity, CommandRegistry, type CommandDefinition } from "../../src/contracts/command.js";
import { createYesCommand } from "../../src/commands/yes/index.js";
import { createCmpCommand } from "../../src/commands/cmp/index.js";

function foreignCommand(): CommandDefinition & { readonly runtimeIdentity: object } {
  return { name: "foreign", runtimeIdentity: Object.freeze({}), execute: () => ({ exitCode: 0 }) };
}

test("commands bound to another runtime are rejected before registration", () => {
  const registry = new CommandRegistry();
  assert.throws(() => registry.register(foreignCommand()), /matching shell runtime/);
  assert.equal(registry.has("foreign"), false);
});

test("foreign runtime replacement preserves the existing command", () => {
  const registry = new CommandRegistry([{ name: "foreign", execute: () => ({ exitCode: 7 }) }]);
  const existing = registry.get("foreign");
  assert.throws(() => registry.register(foreignCommand(), { replace: true }), /matching shell runtime/);
  assert.equal(registry.get("foreign"), existing);
});

test("constructor registration enforces runtime affinity", () => {
  assert.throws(() => new CommandRegistry([foreignCommand()]), /matching shell runtime/);
});

test("runtime-independent custom definitions remain supported", () => {
  const registry = new CommandRegistry([{ name: "custom", execute: () => ({ exitCode: 0 }) }]);
  assert.equal(registry.has("custom"), true);
});

test("matching runtime identity is retained in the registered snapshot", () => {
  const registry = new CommandRegistry([{ name: "local", runtimeIdentity: commandRuntimeIdentity, execute: () => ({ exitCode: 0 }) }]);
  assert.equal(registry.get("local")?.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(Object.isFrozen(commandRuntimeIdentity), true);
});

test("owned optional factories declare their runtime dependency", () => {
  for (const command of [createYesCommand(), createCmpCommand()]) {
    assert.equal(command.runtimeIdentity, commandRuntimeIdentity, command.name);
    assert.equal(new CommandRegistry([command]).has(command.name), true);
  }
});

test("identity validation observes the stored snapshot rather than rereading getters", () => {
  const registry = new CommandRegistry();
  let reads = 0;
  registry.register({
    name: "changing", execute: () => ({ exitCode: 0 }),
    get runtimeIdentity() { return ++reads === 1 ? commandRuntimeIdentity : Object.freeze({}); },
  });
  assert.equal(reads, 1);
  assert.equal(registry.get("changing")?.runtimeIdentity, commandRuntimeIdentity);
});

test("foreign identity in the stored snapshot cannot replace an existing definition", () => {
  const registry = new CommandRegistry([{ name: "changing", execute: () => ({ exitCode: 7 }) }]);
  const previous = registry.get("changing");
  let reads = 0;
  const definition = {
    name: "changing", execute: () => ({ exitCode: 0 }),
    get runtimeIdentity() { reads++; return Object.freeze({}); },
  };
  assert.throws(() => registry.register(definition, { replace: true }), /matching shell runtime/);
  assert.equal(reads, 1);
  assert.equal(registry.get("changing"), previous);
});

test("inherited affinity is captured before metadata side effects and retained as immutable own metadata", () => {
  const registry = new CommandRegistry();
  const foreignIdentity = Object.freeze({});
  const prototype = { runtimeIdentity: commandRuntimeIdentity };
  const execute = () => ({ exitCode: 7 });
  let metadataReads = 0;
  const definition = Object.create(prototype, {
    name: { enumerable: true, value: "inherited" },
    execute: { enumerable: true, value: execute },
    description: { enumerable: true, get() {
      metadataReads++;
      prototype.runtimeIdentity = foreignIdentity;
      return "captured metadata";
    } },
  }) as CommandDefinition;

  assert.equal(Object.hasOwn(definition, "runtimeIdentity"), false);
  registry.register(definition);
  const stored = registry.get("inherited");
  assert.ok(stored);
  assert.equal(metadataReads, 1);
  assert.equal(definition.runtimeIdentity, foreignIdentity);
  assert.equal(Object.hasOwn(stored, "runtimeIdentity"), true);
  assert.equal(stored.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(stored.execute, execute);
  assert.equal(stored.description, "captured metadata");
  assert.equal(Object.isFrozen(stored), true);

  assert.throws(() => registry.register(definition, { replace: true }), /matching shell runtime/);
  assert.equal(registry.get("inherited"), stored);
  assert.equal(stored.runtimeIdentity, commandRuntimeIdentity);
});
