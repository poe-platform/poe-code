import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { streamCommands } from "../../../../src/commands/streams.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";

for (const command of ["mapfile", "readarray"]) {
  for (const extension of [false, true]) {
    for (const options of ["", "-C callback -c1", "-O2 -s1 -C callback -c1"]) {
      test(`${command} ${options} preserves associative destination and input (${extension ? "extension" : "core"})`, async context => {
        const shell = new Shell({
          fs: createMemoryFileSystem(),
          extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])],
        });
        for (const builtin of basicCommands()) shell.register(builtin);
        for (const builtin of streamCommands()) shell.register(builtin);
        context.after(() => shell.dispose());
        const source = `declare -A rows=([keep]=original); calls=0; callback() { calls=$((calls + 1)); }; exec 3<&0; ${command} -u3 -t ${options} rows; printf 'rc=%s,calls=%s\\n' "$?" "$calls"; printf 'keys=<%s>,values=<%s>\\n' "\${!rows[@]}" "\${rows[@]}"; cat <&3`;
        const input = "one\ntwo\n";
        const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source, "shell"], {
          input, encoding: "utf8", env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
        });
        assert.ifError(native.error);
        assert.equal(native.status, 0);
        assert.equal(native.stdout, "rc=1,calls=0\nkeys=<keep>,values=<original>\none\ntwo\n");
        assert.equal(native.stderr, `shell: line 1: ${command}: rows: not an indexed array\n`);
        const actual = await shell.exec(source, { stdin: input });
        assert.equal(actual.exitCode, native.status, actual.stderr);
        assert.equal(actual.stdout, native.stdout);
        assert.equal(actual.stderr, native.stderr);
      });
    }
  }
}
