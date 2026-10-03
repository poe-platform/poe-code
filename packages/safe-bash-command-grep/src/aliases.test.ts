import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createGrepAliases } from "./aliases.js";
import { createGrepCommand } from "./index.js";

const cases = [
  { args: ["needle", "src"], output: "src/a.ts:needle\nsrc/nested/b.ts:needle\nsrc/nested/c.txt:needle\n" },
  { args: ["-n", "-i", "needle", "src"], output: "src/a.ts:1:Needle\nsrc/a.ts:2:needle\nsrc/nested/b.ts:1:needle\nsrc/nested/c.txt:1:needle\n" },
  { args: ["--include=*.ts", "needle", "src"], output: "src/a.ts:needle\nsrc/nested/b.ts:needle\n" },
  { args: ["-h", "needle", "-"], output: "needle stdin\n" },
  { args: ["missing", "src"], output: "", code: 1 },
];

for (const { args, output, code = 0 } of cases) {
  test(`rgrep ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/src/nested", { recursive: true });
    for (const path of ["src/a.ts", "src/nested/b.ts", "src/nested/c.txt"]) {
      await fs.writeFile(`/${path}`, await readFile(new URL(`../fixtures/rgrep/${path}`, import.meta.url)));
    }
    const command = createGrepAliases(createGrepCommand()).find(command => command.name === "rgrep");
    assert.ok(command, "rgrep is registered");
    const values = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: "rgrep", args: values.args, argumentValues: values, fs, cwd: "/", env: {},
      stdin: toByteSource("needle stdin\nother\n"), stdinIsDefault: false,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: code, stdout: output, stderr: "" });
    const native = spawnSync("grep", ["-r", ...args], {
      cwd: new URL("../fixtures/rgrep/", import.meta.url),
      input: "needle stdin\nother\n", encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, timeout: 2000,
    });
    assert.ifError(native.error);
    assert.deepEqual({ exitCode: native.status, stdout: native.stdout, stderr: native.stderr }, { ...result, stdout, stderr });
  });
}

test("rgrep preserves inherited stdin provenance and binds invocation and cleanup hooks", async () => {
  const context = Object.assign(Object.create({ stdinIsDefault: false }), {
    args: ["needle"],
    invoke(this: unknown) { assert.equal(this, context); },
    registerCleanup(this: unknown) { assert.equal(this, context); },
  }) as CommandContext;
  const command = createGrepAliases({ name: "grep", async execute(forwarded) {
    assert.deepEqual(forwarded.args, ["-r", "needle"]);
    assert.equal(forwarded.stdinIsDefault, false);
    await forwarded.invoke!("true", []);
    forwarded.registerCleanup!(() => {});
    return { exitCode: 0 };
  } }).find(command => command.name === "rgrep");
  assert.ok(command, "rgrep is registered");
  await command.execute(context);
});
