import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { predicateCommands } from "../../src/commands/predicates.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/shell.js";
import { fixture } from "./helpers.js";

for (const command of ["test", "["]) {
  test(`${command} string ordering matches Bash C UTF-8 byte order`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry([...basicCommands(), ...predicateCommands()]) });
    const pairs = [
      ["Changed \uF100 End", "Changed \u{30000} End"],
      ["Owned \uE100 Tail", "Owned \u{10001} Tail"],
      ["\uFFFF", "\u{10000}"],
      ["a", "b"], ["a", "a suffix"], ["", "a"],
      ["é", "ê"], ["\u{10001}", "\u{30000}"],
      ["same \u{30000}", "same \u{30000}"],
    ];
    try {
      for (const pair of pairs) {
        for (const [left, right] of [pair, [...pair].reverse()]) {
          for (const operator of ["<", ">"]) {
            const source = `${command} '${left}' '${operator}' '${right}'${command === "[" ? " ]" : ""}`;
            const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, encoding: "utf8" });
            assert.ifError(native.error);
            assert.ok(native.status === 0 || native.status === 1, source);
            const actual = await shell.exec(source);
            assert.equal(actual.exitCode, native.status, source);
            assert.equal(actual.stdout, native.stdout, source);
            assert.equal(actual.stderr, native.stderr, source);
          }
        }
      }
    } finally { await shell.dispose(); }
  });
}
