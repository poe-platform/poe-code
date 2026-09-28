import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/shell.js";

for (const maxExpansionBytes of [undefined, 65536]) {
  test(`dynamic directory and function parameters with expansion budget ${maxExpansionBytes}`, async context => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/tmp", { recursive: true });
    const shell = new Shell({ fs, cwd: "/tmp", limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
    for (const command of basicCommands()) shell.register(command);
    context.after(() => shell.dispose());
    const result = await shell.exec(`
      echo "<\${!DIR*}>" "<\${!DIR@}>"
      echo "<$DIRSTACK>" "<\${DIRSTACK}>"
      x=$DIRSTACK; echo "<$x>"
      d=DIRSTACK; echo "<\${!d}>"
      echo "<\${!DIR*}>" "<\${!DIR@}>"
      f() { echo "<\${!FUNC*}>" "<\${!FUNC@}>" "<$FUNCNAME>"; }; f
      pushd / >/dev/null; echo "<$DIRSTACK>"
      x=$DIRSTACK; echo "<$x>" "<\${!d}>" "<\${DIRSTACK[*]}>"
      popd >/dev/null; echo "<$DIRSTACK>"
      [[ $DIRSTACK == /tmp ]] && echo conditional
    `);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "<DIRSTACK> <DIRSTACK>\n</tmp> </tmp>\n</tmp>\n</tmp>\n<DIRSTACK> <DIRSTACK>\n<FUNCNAME> <FUNCNAME> <f>\n</>\n</> </> </ /tmp>\n</tmp>\nconditional\n");
  });

  for (const [ifs, separator] of [["IFS=:", ":"], ["IFS=''", ""], ["IFS=$'\\xff'", "\xff"]]) {
    test(`scalar member operators and positional separators: ${ifs}, budget ${maxExpansionBytes}`, async context => {
      const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" }, limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
      for (const command of basicCommands()) shell.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(`
        arr=(a b c); ${ifs}; p=b
        x1=\${arr[*]/b/X}; x2=\${arr[*]/$p/X}; x6=\${arr[*]@U}
        set -u
        x3=\${arr[*]/b/X}; x4=\${arr[*]^^}; x5=\${arr[*]#a}
        set -- a b c
        q1=$@; q2="$@"; q3=\${@/b/X}; q4="\${@/b/X}"
        s1=$*; s2="$*"; s3=\${*/b/X}; at=\${arr[@]/b/X}
        printf '<%s>\\n' "$x1" "$x2" "$x3" "$x4" "$x5" "$x6" "$q1" "$q2" "$q3" "$q4" "$s1" "$s2" "$s3" "$at"
      `);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      const expected = [
        ["a", "X", "c"].join(separator), ["a", "X", "c"].join(separator), ["a", "X", "c"].join(separator),
        ["A", "B", "C"].join(separator), ["", "b", "c"].join(separator), ["A", "B", "C"].join(separator),
        "a b c", "a b c", "a X c", "a X c", ["a", "b", "c"].join(separator), ["a", "b", "c"].join(separator),
        ["a", "X", "c"].join(separator), "a X c",
      ].map(value => `<${value}>\n`).join("");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(expected, "latin1"));
    });
  }
}
