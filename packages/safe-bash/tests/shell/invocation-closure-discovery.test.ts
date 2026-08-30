import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError, writeText } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { discoveryCases } from "./invocation-closure-cases.js";
import { sourceHashes, virtualObservation } from "./invocation-closure-native.js";
import type { Observation } from "./invocation-closure-native.js";

const before = await sourceHashes();
after(async () => assert.deepEqual(await sourceHashes(), before));
const reference = JSON.parse(await readFile(new URL("./invocation-closure-discovery-reference.json", import.meta.url), "utf8")) as { profiles: { observations: { name: string; mode: "bash" | "sh"; cwd: string; observation: Observation }[] }[] };
for (const entry of reference.profiles[0]!.observations) test(`discovery native primary ${entry.mode}: ${entry.name}`, async () => {
  assert.deepEqual(await virtualObservation(discoveryCases.find(fixture => fixture.name === entry.name)!, entry.mode, entry.cwd), entry.observation);
});

test("registry and virtual interpreters are real, not imaginary native builtins", async () => {
  const { shell, commands } = setup();
  const result = await shell.exec("type say bash sh; type -t say bash sh; command -v say bash sh printf cat; command say ok");
  assert.equal(result.stdout, "say is a registered command\nbash is a virtual shell interpreter\nsh is a virtual shell interpreter\ncommand\ninterpreter\ninterpreter\nsay\nbash\nsh\nok\n");
  assert.equal(result.stderr, "");
  commands.unregister("say");
  assert.equal((await shell.exec("command -v say")).exitCode, 1);
});

test("command bypasses functions but not registry, middleware or input origin", async () => {
  const { shell, commands } = setup();
  const seen: string[] = [];
  shell.use(async (context, next) => { seen.push(context.command); return next(); });
  commands.register({ name: "origin", async execute(context) { assert.equal(context.stdinIsDefault, false); await writeText(context.stdout, context.args.join("|")); return { exitCode: 19 }; } });
  const result = await shell.exec('origin() { say bad; }; command origin "" "a b"', { stdin: "" });
  assert.equal(result.stdout, "|a b");
  assert.equal(result.exitCode, 19);
  assert.deepEqual(seen, ["command", "origin"]);
});

test("discovery and dispatch refresh permissions, symlinks and cwd", async () => {
  const { shell, fs } = setup();
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/tool", Buffer.from("#!/bin/bash\nsay live\n"), { mode: 0o755 });
  await fs.symlink("tool", "/bin/link");
  assert.equal((await shell.exec("PATH=/bin; command -v link; command link")).stdout, "/bin/link\nlive\n");
  await fs.chmod("/bin/tool", 0o644);
  assert.equal((await shell.exec("PATH=/bin; command -v link")).exitCode, 1);
  assert.equal((await shell.exec("PATH=/bin; command link")).exitCode, 126);
  await fs.rm("/bin/tool");
  assert.equal((await shell.exec("PATH=/bin; command -v link")).exitCode, 1);
});

test("unknown permission capability never advertises executable availability", async () => {
  const { fs, commands } = setup();
  await fs.writeFile("/tool", Buffer.from("#!/bin/bash\ntrue\n"), { mode: 0o755 });
  const wrapped = new Proxy(fs, { get(target, key) { if (key === "capabilities") return {}; const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  const shell = new Shell({ fs: wrapped, commands });
  const result = await shell.exec("PATH=/; command -v tool; type -t tool");
  assert.equal(result.stdout, "");
  assert.notEqual(result.exitCode, 0);
});

test("unsupported discovery options do not silently dispatch", async () => {
  for (const source of ["command -p say bad", "command -x say bad", "type -x say"]) {
    const result = await setup().shell.exec(source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    if (source === "command -x say bad") {
      assert.equal(result.stderr, "shell: line 1: command: -x: invalid option\ncommand: usage: command [-pVv] command [arg ...]\n");
    } else assert.match(result.stderr, /unsupported option/u);
  }
});

test("resolver cancellation retains errno-shaped reason identity", async () => {
  const { fs, commands } = setup();
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "stop lookup" });
  const wrapped = new Proxy(fs, { get(target, key) { if (key === "stat") return async () => { controller.abort(reason); throw reason; }; const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; } });
  await assert.rejects(new Shell({ fs: wrapped, commands }).exec("command -v absent", { signal: controller.signal }), error => error === reason);
});

for (const name of ["command-depth", "command-count", "command-output", "command-loop", "command-source", "lookup-late-rejection"]) test(`bounded discovery probe: ${name}`, () => {
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./invocation-closure-probe.ts", import.meta.url)), name], { timeout: 5000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), `PASS ${name}\n`);
});

test("command declaration arguments preserve assignment expansion", async () => {
  const result = await setup().shell.exec('VALUE="a b"; command -- export COPY=$VALUE; args "$COPY"');
  assert.equal(result.stdout, '["a b"]');
  assert.equal(result.stderr, "");
});

test("type -ap requires a real file even when a builtin exists", async () => {
  const result = await setup().shell.exec("PATH=; type -ap true");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
});
