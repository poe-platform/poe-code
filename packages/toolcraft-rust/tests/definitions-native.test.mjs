import { test } from "node:test";
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import * as native from "../dist/index.js";
const reference = await tsImport("../../toolcraft/src/index.ts", import.meta.url);
const { S } = reference;

function atSource(create) {
  const OriginalError = globalThis.Error;
  globalThis.Error = class extends OriginalError {
    stack = "Error\n at fixture (file:///repo/commands/run.ts:12:4)";
  };
  try {
    return create();
  } finally {
    globalThis.Error = OriginalError;
  }
}

// Include symbol metadata, property attributes and graph sharing. Functions and
// caller-owned schemas retain their original identities in the host heap.
function shape(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return { reference: seen.get(value) };
  seen.set(value, seen.size);
  return Reflect.ownKeys(value).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return [
      typeof key === "symbol" ? `symbol:${key.description}` : key,
      { ...descriptor, value: shape(descriptor.value, seen) }
    ];
  });
}

test("command definitions preserve host values, descriptors and metadata snapshots", () => {
  const params = S.Object({ value: S.String() });
  const annotations = { title: "Read", readOnlyHint: true };
  const examples = [{ title: "Example", params: { value: "x", nested: { shared: true } } }];
  const handler = (context) => context.params;
  const config = {
    name: "run",
    params,
    handler,
    annotations,
    examples,
    aliases: ["r"],
    positional: ["value"],
    secrets: JSON.parse('{"__proto__":{"env":"TOKEN"}}')
  };
  const actual = atSource(() => native.defineCommand(config));
  const expected = atSource(() => reference.defineCommand(config));
  assert.deepEqual(shape(actual), shape(expected));
  assert.equal(actual.params, params);
  assert.equal(actual.handler, handler);
  assert.equal(native.getCommandSourcePath(actual), "/repo/commands/run.ts");
  annotations.title = "changed";
  examples[0].params.value = "changed";
  config.aliases.push("changed");
  assert.deepEqual(shape(actual), shape(expected));
  assert.equal(actual.annotations.title, "Read");
  assert.equal(actual.examples[0].params.value, "x");
});

test("nested groups inherit scopes, secrets, approvals and ordered preconditions", async () => {
  const params = S.Object({});
  const events = [];
  const check = (label) =>
    async function () {
      events.push([label, this]);
      return { ok: true };
    };
  const checks = [check("root"), check("group"), check("command")];
  const approval = { mode: "sync", message: () => "Confirm" };
  const handler = () => "ready";
  const make = (lib) =>
    atSource(() => {
      const command = lib.defineCommand({
        name: "run",
        params,
        handler,
        humanInLoop: null,
        secrets: { token: { env: "CHILD" } },
        requires: { auth: false, check: checks[2] }
      });
      const group = lib.defineGroup({
        name: "group",
        children: [command],
        default: command,
        requires: { check: checks[1] }
      });
      return lib.defineGroup({
        name: "root",
        scope: ["mcp"],
        humanInLoop: approval,
        secrets: { token: { env: "PARENT" }, other: { env: "OTHER", optional: true } },
        requires: { auth: true, apiVersion: ">=1.0.0", check: checks[0] },
        children: [group]
      });
    });
  for (const lib of [native, reference]) {
    const root = make(lib),
      group = root.children[0],
      command = group.children[0];
    assert.equal(group.default, command);
    assert.equal(root.humanInLoop, approval);
    assert.equal(command.humanInLoop, null);
    assert.deepEqual(command.scope, ["mcp"]);
    assert.equal(command.requires.auth, false);
    assert.equal(command.requires.apiVersion, ">=1.0.0");
    assert.deepEqual(command.secrets, {
      token: { env: "CHILD", description: undefined, optional: undefined },
      other: { env: "OTHER", description: undefined, optional: true }
    });
    events.length = 0;
    await command.requires.check({});
    assert.deepEqual(events, [
      ["root", undefined],
      ["group", undefined],
      ["command", undefined]
    ]);
    const cloned = lib.cloneCommandNode(lib.cloneCommandNode(root));
    events.length = 0;
    await cloned.children[0].children[0].requires.check({});
    assert.deepEqual(
      events.map(([label]) => label),
      ["root", "group", "command"]
    );
  }
});

test("groups snapshot own metadata and explicit empty scope suppresses inheritance", () => {
  const params = S.Object({}),
    handler = () => 1;
  const make = (lib) =>
    atSource(() => {
      const command = lib.defineCommand({
        name: "run",
        params,
        handler,
        scope: [],
        hidden: true,
        annotations: { title: "original" }
      });
      command.annotations.title = "ignored";
      command.hidden = false;
      command.aliases.push("kept");
      return lib.defineGroup({
        name: "root",
        scope: ["mcp"],
        children: [command],
        default: command
      });
    });
  assert.deepEqual(shape(make(native)), shape(make(reference)));
});

test("cloning works across bundles and removes discovered proxy children", () => {
  const params = S.Object({}),
    handler = () => 1;
  const build = (lib) =>
    atSource(() => {
      const declared = lib.defineCommand({ name: "declared", params, handler });
      const discovered = lib.defineCommand({ name: "discovered", params, handler });
      Object.defineProperty(discovered, Symbol("toolcraft.mcpProxyNode"), { value: true });
      const root = lib.defineGroup({
        name: "remote",
        mcp: { transport: "stdio", command: "server", args: ["--json"], env: { MODE: "test" } },
        rename: { upstream: "a.b" },
        tools: ["upstream"],
        children: [declared],
        default: declared
      });
      root.children.push(discovered);
      return root;
    });
  for (const [source, target] of [
    [reference, native],
    [native, reference],
    [native, native]
  ]) {
    const root = build(source);
    assert.equal(target.hasMcpProxyConfig(root), true);
    const clone = target.cloneCommandNode(root, ["sdk"]);
    assert.deepEqual(
      clone.children.map((child) => child.name),
      ["declared"]
    );
    assert.equal(clone.default, clone.children[0]);
    assert.deepEqual(clone.children[0].scope, ["sdk"]);
    assert.equal(clone.children[0].handler, handler);
  }
});

test("stream definitions retain event/handler identity and disable confirmation", () => {
  const config = {
    name: "watch",
    params: S.Object({}),
    event: S.Number(),
    handler: async function* () {
      yield 1;
    },
    render: { rich() {} }
  };
  const actual = atSource(() => native.defineStreamCommand(config));
  const expected = atSource(() => reference.defineStreamCommand(config));
  assert.deepEqual(shape(actual), shape(expected));
  const clone = native.cloneCommandNode(actual);
  assert.equal(clone.stream.event, config.event);
  assert.notEqual(clone.stream, actual.stream);
});

test("definition validation preserves error classes, text and validation order", () => {
  const params = S.Object({}),
    handler = () => 1;
  const cases = [
    (lib) => lib.defineCommand({ name: "a", params, handler, mcpResult: handler }),
    ...[{ mode: "bad" }, { mode: "sync" }, { mode: "async", message: handler, plan: 1 }].map(
      (humanInLoop) => (lib) => lib.defineCommand({ name: "a", params, handler, humanInLoop })
    ),
    (lib) =>
      lib.defineCommand({
        name: "a",
        params,
        handler,
        confirm: true,
        humanInLoop: { mode: "bad" }
      }),
    ...[{ a: "" }, { a: "x..y" }, { a: "x", b: "x" }].map(
      (rename) => (lib) => lib.defineGroup({ name: "a", rename, children: [] })
    ),
    (lib) =>
      lib.defineGroup({
        name: "a",
        children: [],
        default: lib.defineCommand({ name: "missing", params, handler })
      }),
    (lib) => {
      const group = lib.defineGroup({ name: "nested", children: [] });
      return lib.defineGroup({ name: "a", children: [group], default: group });
    }
  ];
  for (const create of cases) {
    const error = (lib) => {
      try {
        create(lib);
        assert.fail("expected validation failure");
      } catch (error) {
        return { name: error.name, message: error.message };
      }
    };
    assert.deepEqual(error(native), error(reference));
  }
});
