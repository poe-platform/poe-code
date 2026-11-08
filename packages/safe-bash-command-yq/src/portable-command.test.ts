import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqCommand } from "./query.js";
import { createMikeYqCommand } from "./mike.js";
import type { CommandContext } from "safe-bash-contracts";

for (const factory of [createYqCommand, createMikeYqCommand]) for (const args of [[".a", "-o", "json", "-c"], [".a", "-o", "json", "-r"]]) {
  test(`yq ${factory.name} evaluates YAML without Buffer: ${args.join(" ")}`, async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
    const chunks: Uint8Array[] = [];
    const input = new TextEncoder().encode("a: é🐈\n");
    const command = factory();
    Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
    try {
      const result = await command.execute({ command: "yq", args: [...args, "-"],
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
        env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
      } as unknown as CommandContext);
      assert.equal(result.exitCode, 0);
      assert.ok(chunks.some(bytes => new TextDecoder().decode(bytes).includes("é🐈")));
    } finally { Object.defineProperty(globalThis, "Buffer", descriptor); }
  });
}

for (const factory of [createYqCommand, createMikeYqCommand]) {
  test(`${factory.name} preserves retained output across multiple batches`, async () => {
    const values = Array.from({ length: 1800 }, (_, index) => `row_${index}_é🐈_match`);
    const input = new TextEncoder().encode(JSON.stringify(values));
    const chunks: Uint8Array[] = [];
    const result = await factory().execute({
      command: "yq", args: [".[]", "-o", "json", "-r", "-"],
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
      env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
    } as unknown as CommandContext);
    assert.equal(result.exitCode, 0);
    assert.ok(chunks.length > 3);
    assert.equal(chunks.map(bytes => new TextDecoder().decode(bytes)).join(""), values.join("\n") + "\n");
  });
}

for (const factory of [createYqCommand, createMikeYqCommand]) for (const [name, input, expected] of [
  ["block mapping anchor", "defaults: &base\n  retries: 3\n  timeout_ms: 1500\nstaging:\n  policy: *base\n", { defaults: { retries: 3, timeout_ms: 1500 }, staging: { policy: { retries: 3, timeout_ms: 1500 } } }],
  ["block sequence anchor", "items: &list\n  - a\n  - b\ncopy: *list\n", { items: ["a", "b"], copy: ["a", "b"] }],
  ["tag then anchor", "a: !!map &base\n  key: value\nb: *base\n", { a: { key: "value" }, b: { key: "value" } }],
  ["anchor then tag", "a: &base !!seq\n  - value\nb: *base\n", { a: ["value"], b: ["value"] }],
  ["verbatim tag", "a: !<tag:yaml.org,2002:map> &base\n  key: value\nb: *base\n", { a: { key: "value" }, b: { key: "value" } }],
  ["sequence item", "- &base !!map\n  key: value\n- *base\n", [{ key: "value" }, { key: "value" }]],
  ["empty sequence item", "- &empty\n- *empty\n", [null, null]],
  ["empty mapping value", "a: &empty\nb: *empty\n", { a: null, b: null }],
  ["empty string tag", "a: &empty !!str\nb: *empty\n", { a: "", b: "" }],
  ["root properties", "!!map &root\na: value\n", { a: "value" }],
  ["root empty anchor", "&empty\n", null],
  ["indentless sequence", "a: !!seq &items\n- value\nb: *items\n", { a: ["value"], b: ["value"] }],
  ["comments and blank lines", "a: &base # anchor\n\n  # comment\n  key: value\nb: *base\n", { a: { key: "value" }, b: { key: "value" } }],
  ["explicit mapping value", "? a\n: &base !!seq\n  - value\nb: *base\n", { a: ["value"], b: ["value"] }],
] as const) {
  test(`${factory.name} composes properties on ${name}`, async () => {
    const stdout: string[] = [], stderr: string[] = [];
    const result = await factory().execute({
      command: "yq", args: ["-o", "json", ".", "-"],
      stdin: (async function* () { yield new TextEncoder().encode(input); })(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(new TextDecoder().decode(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(new TextDecoder().decode(bytes)); } },
      env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
    } as unknown as CommandContext);
    assert.equal(stderr.join(""), "");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(stdout.join("")), expected);
  });
}

for (const [name, input, code, limits] of [
  ["self alias", "a: &base\n  self: *base\n", "ALIAS_CURRENT_NODE", {}],
  ["sequence self alias", "a: &base\n  - *base\n", "ALIAS_CURRENT_NODE", {}],
  ["forward alias", "a: *base\nb: &base\n  key: value\n", "ALIAS_FORWARD", {}],
  ["wrong collection tag", "a: !!seq\n  key: value\n", "SCHEMA_TAG_KIND_MISMATCH", {}],
  ["empty collection tag", "a: !!map\n", "SCHEMA_TAG_KIND_MISMATCH", {}],
  ["duplicate anchor property", "a: &one &two\n  key: value\n", "INPUT_YAML_SYNTAX", {}],
  ["duplicate tag property", "a: !!map !!map\n  key: value\n", "INPUT_YAML_SYNTAX", {}],
  ["alias quota", "a: &base\n  key: value\nb: *base\n", "LIMIT_MAX_ALIAS_REFERENCES", { maxAliasReferences: 0 }],
] as const) {
  test(`yq rejects ${name} on property-only headers`, async () => {
    const stdout: string[] = [], stderr: string[] = [];
    const result = await createYqCommand({ limits }).execute({
      command: "yq", args: ["-o", "json", ".", "-"],
      stdin: (async function* () { yield new TextEncoder().encode(input); })(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(new TextDecoder().decode(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(new TextDecoder().decode(bytes)); } },
      env: {}, cwd: "/", fs: {}, signal: new AbortController().signal,
    } as unknown as CommandContext);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.join("").includes(code), stderr.join(""));
    assert.equal(stdout.join(""), "");
  });
}
