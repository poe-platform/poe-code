import assert from "node:assert/strict";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { CommandDefinition } from "safe-bash-contracts";

const bundle = await build({
  stdin: { contents: `
    export { createYqCommand } from "./query.ts";
    export { createYqCommand as createMikeYqCommand } from "./index.ts";
    export { createMemoryFileSystem } from "@poe-code/safe-fs/core";
    export { createCommandArguments } from "safe-bash-contracts";
  `, resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
  bundle: true, platform: "browser", conditions: ["workerd", "browser"],
  format: "cjs", write: false, logLevel: "silent",
});
const sandbox = createContext({
  TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, AbortSignal,
  setTimeout, clearTimeout, queueMicrotask, performance, crypto: globalThis.crypto,
  atob, btoa, module: { exports: {} },
});
runInContext(bundle.outputFiles[0]!.text, sandbox);
const { createYqCommand, createMikeYqCommand, createMemoryFileSystem, createCommandArguments } = sandbox.module.exports as
  typeof import("./query.js") & typeof import("./mike.js") & typeof import("@poe-code/safe-fs/core") & typeof import("safe-bash-contracts");

async function run(command: CommandDefinition, args: string[], input = "", fs = createMemoryFileSystem()) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const stdout: string[] = [], stderr: string[] = [];
  assert.equal(runInContext("typeof Buffer", sandbox), "undefined");
  const carrier = createCommandArguments(args);
  const result = await command.execute({
    command: "yq", args: carrier.args, argumentValues: carrier,
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () { yield encoder.encode(input); })(),
    stdout: { async write(bytes) { stdout.push(decoder.decode(bytes)); } },
    stderr: { async write(bytes) { stderr.push(decoder.decode(bytes)); } },
  });
  return { exitCode: result.exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

for (const [profile, command, cases] of [
  ["query", createYqCommand(), [
    [[".a"], "a: 1\n", "1\n"],
    [["-o", "json", "-r", ".[]"], '["a", "é", "🌊", "last"]', "a\né\n🌊\nlast\n"],
    [["-o", "json", "-r", ".a | @base64"], "a: é🌊\n", "w6nwn4yK\n"],
    [["-o", "json", "-r", ".a | @base64d"], "a: w6nwn4yK\n", "é🌊\n"],
  ]],
  ["native", createMikeYqCommand(), [
    [[".a"], "a: 1\n", "1\n"],
    [["-n", ".a = 1"], "", "a: 1\n"],
    [["-o=json", "-I=0", "sort"], '["🌊", "é", "a", ""]', '["a","é","","🌊"]\n'],
    [["-o=base64", "."], "é🌊\n", "w6nwn4yK"],
    [["-p=base64", "."], "w6nwn4yK", "é🌊\n"],
    [["-p=toml", ".name"], 'name = "é🌊"', "é🌊\n"],
    [["select(. == \"é*\")"], "é🌊\n", "é🌊\n"],
  ]],
] as const) {
  for (const [args, input, stdout] of cases) {
    test(`${profile} yq runs ${args.join(" ")} without global Buffer`, async () => {
      assert.deepEqual(await run(command, [...args], input), { exitCode: 0, stdout, stderr: "" });
    });
  }
}

test("Buffer-free yq preserves byte-based quotas and reports invalid base64", async () => {
  const limited = await run(createMikeYqCommand({ limits: { maxScalarBytes: 4 } }), ["."], "é🌊\n");
  assert.equal(limited.exitCode, 1);
  assert.ok(limited.stderr.includes("maxScalarBytes"), limited.stderr);
  for (const invalid of ["%%%", "YQ", "YR==", "YQ== ", "/w=="]) {
    const result = await run(createMikeYqCommand(), ["-p=base64", "."], invalid);
    assert.equal(result.exitCode, 1, invalid);
    assert.ok(result.stderr.includes("base64"), result.stderr);
  }
});

test("default yq edits files without Buffer or Node builtins", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data.yaml", new TextEncoder().encode("a: 1\n"));
  assert.deepEqual(await run(createMikeYqCommand(), ["-i", ".a = 2", "/data.yaml"], "", fs), {
    exitCode: 0, stdout: "", stderr: "",
  });
  assert.deepEqual(await run(createMikeYqCommand(), [".a", "/data.yaml"], "", fs), {
    exitCode: 0, stdout: "2\n", stderr: "",
  });
});

for (const maxDocumentBytes of [Infinity, 100]) test(`UTF-8 scalar byte admission with document limit ${maxDocumentBytes}`, async () => {
  const command = createMikeYqCommand({ limits: { maxScalarBytes: 4, maxDocumentBytes } });
  assert.equal((await run(command, ["."], '"é"\n')).exitCode, 0);
  const result = await run(command, ["."], '"éé"\n');
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("maxScalarBytes"), result.stderr);
});
