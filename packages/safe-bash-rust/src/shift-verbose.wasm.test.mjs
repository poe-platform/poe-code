import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Captured against GNU Bash 5.3, LC_ALL=C.
const cases = [
  ['shopt -p shift_verbose; shopt -s shift_verbose; shopt -p shift_verbose; shopt -u shift_verbose; shopt -q shift_verbose', 'shopt -u shift_verbose\nshopt -s shift_verbose\n', '', 1],
  ['shopt -s shift_verbose; (shopt -u shift_verbose; shift 4); shift 4', '', 'shell: line 1: shift: 4: shift count out of range\n', 1],
  ['shopt -s shift_verbose; set -- a b; f() { shift 3; }; f x; printf "%s|%s|%s" "$?" "$#" "$*"', '1|2|a b', 'shell: line 1: shift: 3: shift count out of range\n', 0],
  [
    "set -- a b; shift; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|1|b",
    "",
    0
  ],
  [
    "set -- a b; shift 0; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|2|a b",
    "",
    0
  ],
  [
    "set -- a b; shift 1; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|1|b",
    "",
    0
  ],
  [
    "set -- a b; shift 2; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|0|",
    "",
    0
  ],
  [
    "set -- a b; shift 3; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "",
    0
  ],
  [
    "set -- a b; shift -1; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "shell: line 1: shift: -1: shift count out of range\n",
    0
  ],
  [
    "set -- a b; shift x; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "2|2|a b",
    "shell: line 1: shift: x: numeric argument required\n",
    0
  ],
  [
    "set -- a b; shift -- 3; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "",
    0
  ],
  [
    "set -- a b; shift 1 2; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "",
    "shell: line 1: shift: too many arguments\n",
    1
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|1|b",
    "",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift 0; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|2|a b",
    "",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift 1; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|1|b",
    "",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift 2; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "0|0|",
    "",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift 3; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "shell: line 1: shift: 3: shift count out of range\n",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift -1; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "shell: line 1: shift: -1: shift count out of range\n",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift x; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "2|2|a b",
    "shell: line 1: shift: x: numeric argument required\n",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift -- 3; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "1|2|a b",
    "shell: line 1: shift: 3: shift count out of range\n",
    0
  ],
  [
    "shopt -s shift_verbose; set -- a b; shift 1 2; rc=$?; printf \"%s|%s|%s\" \"$rc\" \"$#\" \"$*\"",
    "",
    "shell: line 1: shift: too many arguments\n",
    1
  ],
  [
    "shopt -s shift_verbose; shift; printf \"%s\" \"$?\"",
    "1",
    "shell: line 1: shift: shift count out of range\n",
    0
  ],
  [
    "shopt -s shift_verbose; (shift 4); shopt -q shift_verbose; printf \"%s\" \"$?\"",
    "0",
    "shell: line 1: shift: 4: shift count out of range\n",
    0
  ]
];
for (const runtime of ["TypeScript", "Rust"]) for (const [source, stdout, stderr, exitCode] of cases) {
  test(`${runtime} shift controls: ${source}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, stderr);
      assert.equal(result.exitCode, exitCode);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
