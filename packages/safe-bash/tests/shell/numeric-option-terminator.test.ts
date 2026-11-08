import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

for (const [name, source, stdout, exitCode, stderr] of [
  ["exit status", 'exit -- 0; printf "AFTER:%s\\n" "$?"', "", 0, ""],
  ["return status", 'f() { return -- 0; printf "BODY_AFTER\\n"; }; f; printf "AFTER:%s\\n" "$?"', "AFTER:0\n", 0, ""],
  ["shift zero", 'set -- first second; shift -- 0; printf "AFTER:%s:COUNT:%s\\n" "$?" "$#"', "AFTER:0:COUNT:2\n", 0, ""],
  ["break count", 'for a in 1 2; do printf "ITER:%s\\n" "$a"; break -- 1; printf "BODY_AFTER\\n"; done; printf "AFTER:%s\\n" "$?"', "ITER:1\nAFTER:0\n", 0, ""],
  ["continue count", 'for a in 1 2; do printf "ITER:%s\\n" "$a"; continue -- 1; printf "BODY_AFTER\\n"; done; printf "AFTER:%s\\n" "$?"', "ITER:1\nITER:2\nAFTER:0\n", 0, ""],
  ["exit default", 'false; exit --; printf BODY_AFTER', "", 1, ""],
  ["return default", 'f() { false; return --; printf BODY_AFTER; }; f; printf "AFTER:%s\\n" "$?"', "AFTER:1\n", 0, ""],
  ["shift default", 'set -- first second; shift --; printf "%s:%s:%s\\n" "$?" "$#" "$1"', "0:1:second\n", 0, ""],
  ["break default", 'for a in 1 2; do printf "%s\\n" "$a"; break --; printf BODY_AFTER; done', "1\n", 0, ""],
  ["continue default", 'for a in 1 2; do printf "%s\\n" "$a"; continue --; printf BODY_AFTER; done', "1\n2\n", 0, ""],
  ["exit signed status", 'exit -- -1; printf BODY_AFTER', "", 255, ""],
  ["return wrapped status", 'f() { return -- 257; printf BODY_AFTER; }; f; printf "%s\\n" "$?"', "1\n", 0, ""],
  ["shift count", 'set -- first second third; shift -- 2; printf "%s:%s:%s\\n" "$?" "$#" "$1"', "0:1:third\n", 0, ""],
  ["exit repeated terminator", 'exit -- --', "", 2, "exit: --: numeric argument required\n"],
  ["return repeated terminator", 'f() { return -- --; printf BODY_AFTER; }; f; printf "%s\\n" "$?"', "2\n", 0, "return: --: numeric argument required\n"],
  ["shift repeated terminator", 'set -- first second; shift -- --; printf "%s:%s:%s\\n" "$?" "$#" "$1"', "2:2:first\n", 0, "shift: --: numeric argument required\n"],
  ["exit extra operands", 'exit -- 0 1; printf "%s\\n" "$?"', "1\n", 0, "exit: too many arguments\n"],
  ["return extra operands", 'f() { return -- 0 1; printf "BODY:%s\\n" "$?"; }; f', "BODY:1\n", 0, "return: too many arguments\n"],
  ["shift extra operands", 'set -- first second; shift -- 0 1; printf "%s:%s:%s\\n" "$?" "$#" "$1"', "1:2:first\n", 0, ""],
  ["exit later terminator", 'exit 0 --; printf "%s\\n" "$?"', "1\n", 0, "exit: too many arguments\n"],
] as const) {
  test(`numeric option terminator: ${name}`, async context => {
    const { shell, commands } = setup();
    for (const command of basicCommands()) commands.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.deepEqual({ stdout: result.stdout, exitCode: result.exitCode, stderr: result.stderr }, { stdout, exitCode, stderr });
  });
}

for (const command of ["break", "continue"]) {
  test(`${command} accepts a nested loop count after --`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`for a in 1 2; do for b in 1 2; do say "$a:$b"; ${command} -- 2; say BODY_AFTER; done; say OUTER_AFTER; done; say "AFTER:$?"`);
    assert.equal(result.stdout, command === "break" ? "1:1\nAFTER:0\n" : "1:1\n2:1\nAFTER:0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  test(`${command} consumes only one leading option terminator`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`for a in 1 2; do say "$a"; ${command} -- --; say BODY_AFTER; done; say AFTER`);
    assert.equal(result.stdout, "1\n");
    assert.equal(result.stderr, `${command}: --: numeric argument required\n`);
    assert.equal(result.exitCode, 2);
  });
}
