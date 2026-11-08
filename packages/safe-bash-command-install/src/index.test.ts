import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createInstallCommand, evalSyncInstall } from "./index.js";

for (const scenario of [
 { name: "replacement", existing: true, flags: ["-v"], expected: "removed '/dest'\n'/source' -> '/dest'\n" },
 { name: "missing destination", existing: false, flags: ["-v"], expected: "'/source' -> '/dest'\n" },
 { name: "backup", existing: true, flags: ["-v", "-b"], expected: "'/source' -> '/dest' (backup: '/dest~')\n" },
 { name: "custom backup", existing: true, flags: ["-v", "-S", ".bak"], expected: "'/source' -> '/dest' (backup: '/dest.bak')\n" },
 { name: "backup without destination", existing: false, flags: ["-v", "-b"], expected: "'/source' -> '/dest'\n" },
 { name: "quiet replacement", existing: true, flags: [], expected: "" },
]) {
 test(`sync install diagnostics: ${scenario.name}`, () => {
  const files = new Map<string, Uint8Array>([["/source", new TextEncoder().encode("new")]]);
  if (scenario.existing) files.set("/dest", new TextEncoder().encode("old"));
  const output = evalSyncInstall([...scenario.flags, "/source", "/dest"],
   path => files.get(path),
   (path, bytes) => { files.set(path, bytes); return true; },
   path => files.has(path) ? "file" : "missing",
  );
  assert.equal(output, scenario.expected);
  assert.equal(new TextDecoder().decode(files.get("/dest")), "new");
  const backup = files.get("/dest~") ?? files.get("/dest.bak");
  assert.equal(backup === undefined ? undefined : new TextDecoder().decode(backup),
   scenario.existing && scenario.flags.length > 1 ? "old" : undefined);
 });
}

test("install help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createInstallCommand().execute({
  command: "install", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
