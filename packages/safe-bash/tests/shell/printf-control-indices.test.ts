import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

// GNU Bash 5.3: indexed writes differ from ordinary scalar control writes.
for (const name of ["IFS", "OPTIND"]) {
  for (const index of [0, 1]) {
    test(`printf -v ${name}[${index}]`, async () => {
      const { shell, commands } = setup({ env: { LC_ALL: "C" } });
      for (const command of basicCommands()) commands.register(command);
      try {
        const script = `printf -v ${name}[${index}] %s 7; rc=$?; printf "%s/%s/%s" "$rc" "\${${name}[${index}]}" "\${!${name}[*]}"`;
        const oracle = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", script], {
          env: { LC_ALL: "C" }, timeout: 2000,
        });
        assert.ifError(oracle.error);
        assert.equal(oracle.status, 0);
        assert.equal(oracle.stderr.toString(), "");
        assert.equal(oracle.stdout.toString(), `0/7/${index ? "0 1" : "0"}`);
        const result = await shell.exec(script);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(`0/7/${index ? "0 1" : "0"}`));
      } finally { await shell.dispose(); }
    });
  }
}

for (const [script, stdout] of [
  ['IFS=" "; a=OLD; line="one:two"; printf -v IFS[0] %s :; rc=$?; set -- $line; echo "$rc|$#|$1|$2|$IFS"', "0|1|one:two||:\n"],
  ['set -- -a -b; OPTIND=1; printf -v OPTIND[0] %s 2; rc=$?; getopts ab k; echo "$rc:$k:$OPTIND"', "0:a:2\n"],
  ['IFS=" "; a=OLD; line="one:two"; printf -v IFS %s :; rc=$?; set -- $line; echo "$rc|$#|$1|$2|$IFS"', "0|2|one|two|:\n"],
  ['set -- -a -b; OPTIND=1; printf -v OPTIND %s 2; rc=$?; getopts ab k; echo "$rc:$k:$OPTIND"', "0:b:3\n"],
  ['IFS=" "; a=OLD; line="one:two"; printf -v a[0] %s :; rc=$?; set -- $line; echo "$rc|$#|$1|$2|$IFS"', "0|1|one:two|| \n"],
  ['IFS=" "; line=one:two; printf -v IFS[1] %s extra; printf -v IFS %s :; set -- $line; printf "%s/%s/%s/%s" "$#" "$1" "$2" "${IFS[1]}"', "1/one:two//extra"],
  ['set -- -a -b; printf -v OPTIND[1] %s 7; printf -v OPTIND %s 2; getopts ab k; printf "%s/%s/%s" "$k" "$OPTIND" "${OPTIND[1]}"', "b/3/7"],
  ['set -- -ab; printf -v OPTIND[0] %s 7; getopts ab k; printf "%s/%s/" "$k" "$OPTIND"; getopts ab k; printf "%s/%s" "$k" "$OPTIND"', "a/1/b/2"],
] as const) {
  test(`printf control assignment: ${script}`, async () => {
    const { shell, commands } = setup({ env: { LC_ALL: "C.UTF-8" } });
    for (const command of basicCommands()) commands.register(command);
    try {
      const oracle = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash", ["--noprofile", "--norc", "-c", script], {
        env: { LC_ALL: "C.UTF-8" }, timeout: 2000,
      });
      assert.ifError(oracle.error);
      assert.equal(oracle.status, 0);
      assert.equal(oracle.stderr.toString(), "");
      assert.equal(oracle.stdout.toString(), stdout);
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(stdout));
    } finally { await shell.dispose(); }
  });
}
