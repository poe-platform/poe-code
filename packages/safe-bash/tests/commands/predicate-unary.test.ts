import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createStandardCommands } from "../../src/commands/index.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture, run } from "./helpers.js";

for (const command of ["test", "["]) {
  const args = (flag: string, value: string) => [flag, value, ...(command === "[" ? ["]"] : [])];
  test(`${command} admits special-node and mode predicates`, async () => {
    const fs = await fixture({ "space file": "data" });
    await fs.chmod("/work/space file", 0o7755);
    for (const flag of ["-b", "-p", "-S", "-u", "-g", "-k"]) {
      const result = await run(command, args(flag, "space file"), { fs, commands: predicateCommands() });
      assert.equal(result.exitCode, ["-u", "-g", "-k"].includes(flag) ? 0 : 1, flag);
      assert.equal(result.stderr, "");
      assert.equal((await run(command, args(flag, "missing"), { fs, commands: predicateCommands() })).exitCode, 1);
    }
  });
  test(`${command} queries actual shell variables, references, options and pipe descriptors`, async () => {
    const shell = new Shell({ fs: await fixture(), cwd: "/work", commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    const expression = (flag: string, value: string) => `${command} ${flag} ${value}${command === "[" ? " ]" : ""}; echo $?`;
    const source = `value=''; ${expression("-v", "value")}; ${expression("-v", "missing")}; ${expression("-R", "value")}; declare -n ref=value; ${expression("-R", "ref")}; ${expression("-v", "ref")}; ${expression("-o", "nounset")}; set -u; ${expression("-o", "nounset")}; ${expression("-o", "unknown")}; ${expression("-t", "1")}`;
    const result = await shell.exec(source);
    assert.equal(result.stdout, "0\n1\n1\n0\n0\n1\n0\n1\n1\n");
    assert.equal(result.stderr, "");
    const portableSource = `${expression("-o", "nounset")}; set -u; ${expression("-o", "nounset")}; ${expression("-o", "unknown")}; ${expression("-t", "1")}`;
    const portable = await shell.exec(portableSource);
    const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", portableSource], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "/dev/null" } });
    assert.equal(oracle.status, 0);
    assert.equal(portable.stdout, oracle.stdout);
    assert.equal(portable.stderr, oracle.stderr);
  });
  test(`${command} compares only explicit caller ownership`, async () => {
    const fs = await fixture({ file: "data" });
    for (const flag of ["-O", "-G"]) {
      for (const id of [0, 123]) {
        const result = await run(command, args(flag, "file"), { fs, commands: predicateCommands({ effectiveUid: id, effectiveGid: id }) });
        assert.equal(result.exitCode, id === 0 ? 0 : 1);
        assert.equal(result.stderr, "");
      }
      const unknown = await run(command, args(flag, "file"), { fs, commands: predicateCommands() });
      assert.equal(unknown.exitCode, 1);
      assert.match(unknown.stderr, /ownership predicate requires caller and filesystem identity/u);
      assert.equal((await run(command, args(flag, "missing"), { fs, commands: predicateCommands() })).stderr, "");
    }
  });
  test(`${command} uses reported special-node mode bits`, async () => {
    const fs = await fixture({ file: "data" });
    const stat = await fs.stat("/work/file");
    for (const [flag, mode] of [["-b", 0o060600], ["-p", 0o010600], ["-S", 0o140600]] as const) {
      fs.stat = async () => ({ ...stat, mode });
      assert.equal((await run(command, args(flag, "file"), { fs, commands: predicateCommands() })).exitCode, 0);
    }
  });
}

test("standard command composition exposes explicit ownership", async () => {
  const fs = await fixture({ file: "data" });
  const commands = createStandardCommands({ predicateIdentity: { effectiveUid: 0, effectiveGid: 0 } });
  assert.equal((await run("test", ["-O", "file"], { fs, commands })).exitCode, 0);
  assert.equal((await run("[", ["-G", "file", "]"], { fs, commands })).exitCode, 0);
});
