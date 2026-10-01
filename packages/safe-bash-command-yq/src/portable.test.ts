import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createMikeYqCommand } from "./mike.js";
import { createYqCommand } from "./query.js";

for (const [command, args, input, expected, diagnostic = ""] of [
  [createYqCommand, ["-o", "json", "-r", ".b"], "a: 1\nb: héllo😀\n", "héllo😀\n"],
  [createYqCommand, ["-o", "json", "-c", ".[]"], "[1, 2, 3, 4]\n", "1\n2\n3\n4\n"],
  [createYqCommand, ["-p", "toml", "-o", "json", "-r", ".b"], 'b = "héllo"\n', "héllo\n"],
  [createMikeYqCommand, ["-p", "base64", "-o", "json", "."], "aMOpbGxv8J+YgA==", '"héllo😀"\n'],
  [createMikeYqCommand, ["-o", "base64", "."], '"héllo😀"', "aMOpbGxv8J+YgA=="],
  [createMikeYqCommand, ["-o", "json", "-I", "0", "sort"], '["é", "z", "😀", "a"]', '["a","z","é","😀"]\n'],
  [createMikeYqCommand, ["-o", "json", "-I", "0", '.[] | select(. == "hé*")'], '["héllo", "other"]', '"héllo"\n'],
  [createMikeYqCommand, ["-p", "json", "-o", "json", "-I", "0", "."], '"\\uFEFFhello"', '"\uFEFFhello"\n'],
  [createMikeYqCommand, ["-p", "base64", "-o", "json", "."], "@@@", "", "Error: invalid base64 input\n"],
] as const) test(`yq runs without Buffer: ${args.join(" ")}`, async () => {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args: [...args], stdin: toByteSource(new TextEncoder().encode(input)),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    fs: createMemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
  };
  const saved = globalThis.Buffer;
  let result;
  try { globalThis.Buffer = undefined as never; result = await command().execute(context); }
  finally { globalThis.Buffer = saved; }
  const decode = (chunks: Uint8Array[]) => chunks.map(chunk => new TextDecoder().decode(chunk)).join("");
  assert.equal(decode(stderr), diagnostic);
  assert.equal(result.exitCode, diagnostic ? 1 : 0);
  assert.equal(decode(stdout), expected);
});
