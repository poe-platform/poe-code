import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { predicateCommands } from "../../src/commands/predicates.js";
import { basicCommands } from "../../src/commands/basic.js";
import { FsError } from "../../src/contracts/index.js";
import { setup } from "./helpers.js";

test("conditional file comparisons follow metadata, aliases and missing-file rules", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/old file", new Uint8Array([1]));
  await fs.writeFile("/new", new Uint8Array([2]));
  await fs.utimes("/old file", 1, 1);
  await fs.utimes("/new", 2, 2);
  await fs.link("/old file", "/alias");
  for (const expression of ['"old file" -ef alias', 'new -nt "old file"', '"old file" -ot new', 'new -nt missing', 'missing -ot new']) {
    const result = await shell.exec(`[[ ${expression} ]]`);
    assert.equal(result.exitCode, 0, expression);
    assert.equal(result.stderr, "", expression);
  }
  for (const expression of ['new -ef "old file"', 'missing -ef missing', 'missing -nt new', 'new -ot missing', 'new -nt new']) {
    const result = await shell.exec(`[[ ${expression} ]]`);
    assert.equal(result.exitCode, 1, expression);
    assert.equal(result.stderr, "", expression);
  }
});

test("conditional nameref checks inspect attributes rather than dereferencing", async () => {
  const { shell } = setup();
  const result = await shell.exec('declare -n ref=missing; [[ -R ref ]] && say reference; [[ -R missing ]] || say absent; [[ -t 1 ]] || say virtual');
  assert.equal(result.stdout, "reference\nabsent\nvirtual\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("conditional special-file and mode predicates use reported metadata", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/file", new Uint8Array([1]));
  const stat = await fs.stat("/file");
  for (const [operator, mode] of [["-b", 0o060600], ["-p", 0o010600], ["-S", 0o140600], ["-u", 0o104600], ["-g", 0o102600], ["-k", 0o101600]] as const) {
    fs.stat = async () => ({ ...stat, mode });
    const result = await shell.exec(`[[ ${operator} file ]]`);
    assert.equal(result.exitCode, 0, operator);
    assert.equal(result.stderr, "", operator);
    fs.stat = async () => ({ ...stat, mode: 0o100600 });
    assert.equal((await shell.exec(`[[ ${operator} file ]]`)).exitCode, 1, operator);
  }
});

test("conditional ownership uses explicit caller identity", async () => {
  for (const id of [0, 123]) {
    const { fs, shell } = setup({ capabilities: { predicateIdentity: { effectiveUid: id, effectiveGid: id } } });
    await fs.writeFile("/file", new Uint8Array([1]));
    for (const definition of predicateCommands()) shell.commands.register(definition);
    for (const operator of ["-O", "-G"]) {
      const result = await shell.exec(`[[ ${operator} file ]]`);
      assert.equal(result.exitCode, id === 0 ? 0 : 1, operator);
      assert.equal(result.stderr, "", operator);
      const bracket = await shell.exec(`[ ${operator} file ]`);
      assert.equal(bracket.exitCode, result.exitCode);
      assert.equal(bracket.stderr, "");
      assert.equal((await shell.exec(`[[ ${operator} missing ]]`)).exitCode, 1);
      const empty = await shell.exec(`[[ ${operator} "" ]]`);
      assert.equal(empty.exitCode, 1);
      assert.equal(empty.stderr, "");
    }
  }
});

test("conditional ownership refuses unknown identity without treating it as false", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/file", new Uint8Array([1]));
  for (const operator of ["-O", "-G"]) {
    const result = await shell.exec(`[[ ${operator} file ]]`);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /ownership predicate requires caller and filesystem identity/u);
    const missing = await shell.exec(`[[ ${operator} missing ]]`);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "");
  }
});

test("conditional file predicates do not swallow cancellation", async () => {
  const { fs, shell } = setup();
  const controller = new AbortController();
  const reason = new FsError("ENOENT");
  fs.stat = async () => { controller.abort(reason); throw reason; };
  await assert.rejects(shell.exec('[[ a -ef b ]]', { signal: controller.signal }), error => error === reason);
});

test("conditional virtual terminal predicates match native bash", async () => {
  const { shell } = setup();
  for (const definition of basicCommands()) shell.commands.register(definition);
  const source = '[[ -t 1 ]]; a=$?; [[ -t invalid ]]; b=$?; [[ -t -1 ]]; c=$?; printf "%s\\n" "$a" "$b" "$c"';
  const oracle = spawnSync("bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8", env: { PATH: process.env.PATH, LC_ALL: "C", BASH_ENV: "/dev/null" } });
  assert.equal(oracle.error, undefined);
  assert.equal(oracle.signal, null);
  assert.equal(oracle.status, 0);
  const result = await shell.exec(source);
  assert.equal(result.exitCode, oracle.status);
  assert.equal(result.stdout, oracle.stdout);
  assert.equal(result.stderr, oracle.stderr);
});

test("conditional file predicates preserve short circuiting", async () => {
  const { fs, shell } = setup();
  fs.stat = async () => { throw new Error("unexpected metadata read"); };
  const result = await shell.exec('[[ yes || missing -ef other ]] && [[ "" && -p missing ]] || say done');
  assert.equal(result.stdout, "done\n");
  assert.equal(result.stderr, "");
});
