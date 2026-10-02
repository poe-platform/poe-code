import "../../src/shell/sync-extra-evaluators.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";

async function run(source: string, permissions = true) {
  const fs = new MemoryFileSystem();
  if (!permissions) Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, permissions: false } });
  await fs.writeFile("/file", new TextEncoder().encode("hello"));
  const shell = new Shell({ fs, commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
  try { return await shell.exec(source); }
  finally { await shell.dispose(); }
}

for (const operand of ["0x10", "020", "2#10000", "(8+8)", "1+2*3"]) {
  for (const operator of ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]) {
    for (const syntax of ["extended", "posix"]) {
      test(`loop arithmetic ${syntax} ${operand} ${operator} preserves full evaluation`, async () => {
        const condition = syntax === "extended" ? `[[ $x ${operator} 16 ]]` : `[ "$x" ${operator} 16 ]`;
        const body = syntax === "extended"
          ? `if ${condition}; then echo 0; else echo 1; fi; if [[ ! $x ${operator} 16 ]]; then echo 0; else echo 1; fi`
          : `${condition}; echo $?`;
        const baseline = await run(`x='${operand}'; ${body}`);
        if (syntax === "extended") {
          const equal = operand !== "1+2*3";
          const truth = operator === "-eq" ? equal : operator === "-ne" ? !equal : operator === "-lt" ? !equal : operator === "-le" ? true : operator === "-gt" ? false : equal;
          assert.equal(baseline.stdout, truth ? "0\n1\n" : "1\n0\n");
        }
        const result = await run(`x='${operand}'; for i in 1 2; do ${body}; done`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, baseline.stdout.repeat(2));
      });
    }
  }
}

for (const locale of ["LC_ALL", "LC_CTYPE", "LANG"]) {
  test(`loop conditional matching after ${locale}=C`, async () => {
    const result = await run(`for i in 1 2; do ${locale}=C; if [[ a == a && a = a && a != b ]]; then echo yes; fi; if [[ ! a == a || a != b ]]; then echo negated; fi; done`);
    assert.equal(result.stdout, "yes\nnegated\nyes\nnegated\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const operator of ["-r", "-w", "-x"]) {
  test(`permissionless memory ${operator} matches full evaluation inside loops`, async () => {
    const body = `[[ ${operator} /file ]]; echo $?; [[ ! ${operator} /missing ]]; echo $?; [[ ${operator} /file || ! ${operator} /missing ]]; echo $?`;
    const baseline = await run(body, false);
    const result = await run(`for i in 1 2; do ${body}; done`, false);
    assert.equal(result.stdout, baseline.stdout.repeat(2));
    assert.equal(result.stderr, baseline.stderr.repeat(2));
    assert.equal(result.exitCode, 0);
  });
}

for (const loop of [
  "while [[ $x -eq 16 && $i -lt 2 ]]; do echo yes; i=$((i+1)); done",
  "until [[ ! $x -eq 16 || $i -ge 2 ]]; do echo yes; i=$((i+1)); done",
  "for j in 1; do while [[ $x -eq 16 && $i -lt 2 ]]; do echo yes; i=$((i+1)); done; done",
  "for j in 1; do until [[ ! $x -eq 16 || $i -ge 2 ]]; do echo yes; i=$((i+1)); done; done",
  "for i in 1 2; do [[ $x -eq 16 ]]; echo yes:$?; done",
]) {
  test(`unsupported fast condition in ${loop}`, async () => {
    const result = await run(`x=0x10; i=0; ${loop}`);
    assert.equal(result.stdout, loop.includes("yes:") ? "yes:0\nyes:0\n" : "yes\nyes\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
