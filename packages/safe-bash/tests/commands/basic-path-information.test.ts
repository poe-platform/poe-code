import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";

for (const entry of [
  { name: "basename", args: ["dir/file", "--help"], output: "file\n" },
  { name: "basename", args: ["dir/file", "--version"], output: "file\n" },
  { name: "basename", args: ["-a", "dir/file", "--help"], output: "file\n--help\n" },
  { name: "dirname", args: ["dir/file", "--help"], output: "dir\n.\n", information: true },
  { name: "dirname", args: ["dir/file", "--version"], output: "dir\n.\n", information: true },
  { name: "dirname", args: ["-z", "dir/file", "--help"], output: "dir\0.\0", information: true },
  { name: "basename", args: ["--", "--help"], output: "--help\n" },
  { name: "dirname", args: ["--", "--help"], output: ".\n" },
]) for (const posix of [undefined, "", "1"]) {
  test(`${entry.name} trailing information ${JSON.stringify(entry.args)} POSIXLY_CORRECT=${JSON.stringify(posix)}`, async () => {
    const result = await run(entry.name, entry.args, { commands: basicCommands(), env: posix === undefined ? {} : { POSIXLY_CORRECT: posix } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    if (entry.information && posix === undefined) {
      assert.ok(result.stdout.startsWith(entry.args.includes("--help") ? "Usage: dirname " : "dirname ("));
    } else assert.equal(result.stdout, entry.output);
  });
}

for (const middleware of [false, true]) for (const posix of ["", "1"]) {
  for (const entry of [
    { script: "basename dir/file --help", output: "file\n" },
    { script: "basename -a dir/file --help", output: "file\n--help\n" },
    { script: "dirname dir/file --help", output: "dir\n.\n" },
    { script: "dirname -z dir/file --version", output: "dir\0.\0" },
    { script: "for i in 1 2; do dirname dir/file --help; done", output: "dir\n.\ndir\n.\n" },
    { script: "printf x | dirname dir/file --help", output: "dir\n.\n" },
    { script: "result=$(dirname dir/file --help); printf '%s\\n' \"$result\"", output: "dir\n.\n" },
  ]) test(`${entry.script} POSIXLY_CORRECT=${JSON.stringify(posix)} middleware=${middleware}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    const intercepted: string[] = [];
    if (middleware) shell.use(async (context, next) => { intercepted.push(context.command); return next(); });
    try {
      const result = await shell.exec(entry.script, { env: { POSIXLY_CORRECT: posix } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, entry.output);
      if (middleware) assert.ok(intercepted.length > 0);
    } finally { await shell.dispose(); }
  });
}

for (const entry of [
  { script: "POSIXLY_CORRECT=1 dirname dir/file --help", stop: true },
  { script: "POSIXLY_CORRECT=1; dirname dir/file --help", stop: false },
  { script: "export POSIXLY_CORRECT=1; dirname dir/file --help", stop: true },
  { script: "set -a; POSIXLY_CORRECT=1; dirname dir/file --help", stop: true },
  { script: "export POSIXLY_CORRECT=1; unset POSIXLY_CORRECT; dirname dir/file --help", stop: false },
  { script: "f() { local POSIXLY_CORRECT=1; dirname dir/file --help; }; f", stop: false },
  { script: "export POSIXLY_CORRECT=1; f() { local POSIXLY_CORRECT=; dirname dir/file --help; }; f", stop: true },
]) for (const middleware of [false, true]) {
  test(`dirname uses exported POSIX profile ${entry.script} middleware=${middleware}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    const intercepted: string[] = [];
    if (middleware) shell.use(async (context, next) => { intercepted.push(context.command); return next(); });
    try {
      const result = await shell.exec(entry.script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      if (entry.stop) assert.equal(result.stdout, "dir\n.\n");
      else assert.ok(result.stdout.startsWith("Usage: dirname "));
      if (middleware) assert.ok(intercepted.includes("dirname"));
    } finally { await shell.dispose(); }
  });
}
