import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
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
    const source = `
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
    `;
    const result = await shell.exec(source);
    const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `cd /tmp; ${source}`], { encoding: "utf8", timeout: 2000 });
    assert.equal(native.status, 0, native.stderr);
    assert.equal(result.stdout, native.stdout);
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

for (const maxExpansionBytes of [undefined, 65536]) {
  for (const [name, source, expected] of [
    ["negative slices", 'g() { echo "<${FUNCNAME[@]: -1}>:<${FUNCNAME[*]: -1}>:<${FUNCNAME[@]: -2}>:<${FUNCNAME[@]: -5}>:<${FUNCNAME[*]: -5}>"; }; f() { g; }; f', "<f>:<f>:<g f>:<>:<>\n"],
    ["slice limits", 'g() { set -- "${FUNCNAME[@]: -2:1}" "${FUNCNAME[*]: -1:0}" "${FUNCNAME[@]: 2}"; echo "$#:<$1><$2><$3>"; }; f() { g; }; f', "2:<g><><>\n"],
    ["negative elements", 'g() { echo "<${FUNCNAME[-1]}>:<${FUNCNAME[-2]}>"; }; f() { g; }; f', "<f>:<g>\n"],
    ["negative caller operators", 'g() { echo "<${FUNCNAME[-1]:-missing}>"; set -- ${FUNCNAME[-1]:+"a" "b"}; echo "$#:<$1><$2>"; }; f() { g; }; f', "<f>\n2:<a><b>\n"],
    ["caller operators", 'g() { echo "<${FUNCNAME[1]:-missing}>:<${FUNCNAME[1]-missing}>"; set -- ${FUNCNAME[1]:+"a" "b"}; echo "$#:<$1><$2>"; set -- ${FUNCNAME[1]+"a" "b"}; echo "$#:<$1><$2>"; echo "<${FUNCNAME[5]:-missing}>"; }; f() { g; }; f', "<f>:<f>\n2:<a><b>\n2:<a><b>\n<missing>\n"],
  ] as const) {
    test(`FUNCNAME ${name}, budget ${maxExpansionBytes}`, async context => {
      const shell = new Shell({ fs: createMemoryFileSystem(), limits: maxExpansionBytes === undefined ? {} : { maxExpansionBytes } });
      for (const command of basicCommands()) shell.register(command);
      context.after(() => shell.dispose());
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    });
  }
}
