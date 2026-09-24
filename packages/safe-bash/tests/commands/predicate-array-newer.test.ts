import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture } from "./helpers.js";

for (const command of ["test", "[", "[["]) {
  const expression = (flag: string, value: string) => `${command} ${flag} '${value}'${command === "test" ? "" : command === "[" ? " ]" : " ]]"}; echo $?`;
  test(`${command} resolves array subscripts and array namerefs`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      const result = await shell.exec(`arr=(10 ''); declare -n ref=arr; ${["arr[1]", "arr[2]", "ref[1]", "ref[2]", "ref"].map(value => expression("-v", value)).join("; ")}`);
      assert.equal(result.stdout, "0\n1\n0\n1\n0\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
  test(`${command} -N compares modification and access times and follows symlinks`, async () => {
    const fs = await fixture({ file: "data" });
    await fs.symlink("file", "/work/link");
    const stat = fs.stat.bind(fs);
    let atimeMs = 9;
    fs.stat = async (path, options) => ({ ...await stat(path, options), mtimeMs: 10, atimeMs });
    const shell = new Shell({ fs, cwd: "/work", commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    try {
      for (const [access, expected] of [[9, "0"], [10, "1"], [11, "1"]] as const) {
        atimeMs = access;
        const result = await shell.exec(["file", "link", "missing", ""].map(value => expression("-N", value)).join("; "));
        assert.equal(result.stdout, `${expected}\n${expected}\n1\n1\n`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      }
    } finally { await shell.dispose(); }
  });
}
