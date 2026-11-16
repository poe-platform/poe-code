import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

// Captured against GNU Bash 5.3, LC_ALL=C.
const cases = [
  ['IFS=:; a=(old keep); printf "%s" "${!a[*]}"', '0:1'],
  ['IFS=""; a=(old keep); printf "%s" "${!a[*]}"', '01'],
  ['IFS=:; a=(old keep); printf "<%s>" "${!a[@]}"', '<0><1>'],
  ['a=old; printf -v a[0] %s new; printf "%s|%s" "${!a[*]}" "${a[*]}"', '0|new'],
  ['a=(old keep); printf -v a[1] %s new; printf "%s|%s" "${!a[*]}" "${a[*]}"', '0 1|old new'],
  ['unset a; printf -v a[1] %s new; printf "%s|%s" "${!a[*]}" "${a[*]}"', '1|new'],
  ['a=old; printf -v a[1] %s new; a=last; printf "%s|%s" "${!a[*]}" "${a[*]}"', '0 1|last new'],
  ['IFS=:; printf -v IFS[1] %s 7; set -- first second; printf "%s" "$*"', 'first:second'],
  ['printf -v IFS[1] %s 7; set -- first second; printf "%s" "$*"', 'first second'],
  [
    "printf -v IFS[0] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[0]}\" \"${!IFS[*]}\"",
    "0/7/0"
  ],
  [
    "printf -v IFS[1] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[1]}\" \"${!IFS[*]}\"",
    "0/7/0 1"
  ],
  [
    "unset IFS; printf -v IFS[0] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[0]}\" \"${!IFS[*]}\"",
    "0/7/0"
  ],
  [
    "unset IFS; printf -v IFS[1] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[1]}\" \"${!IFS[*]}\"",
    "0/7/1"
  ],
  [
    "IFS=\"\"; printf -v IFS[0] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[0]}\" \"${!IFS[*]}\"",
    "0/7/0"
  ],
  [
    "IFS=\"\"; printf -v IFS[1] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[1]}\" \"${!IFS[*]}\"",
    "0/7/01"
  ],
  [
    "IFS=:; printf -v IFS[0] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[0]}\" \"${!IFS[*]}\"",
    "0/7/0"
  ],
  [
    "IFS=:; printf -v IFS[1] %s 7; rc=$?; printf \"%s/%s/%s\" \"$rc\" \"${IFS[1]}\" \"${!IFS[*]}\"",
    "0/7/0:1"
  ],
  [
    "a=old; printf -v a[1] %s new; printf \"%s|%s\" \"${!a[*]}\" \"${a[*]}\"",
    "0 1|old new"
  ],
  [
    "printf -v OPTIND[1] %s 7; printf \"%s|%s\" \"${!OPTIND[*]}\" \"${OPTIND[*]}\"",
    "0 1|1 7"
  ]
];
for (const runtime of ["TypeScript", "Rust"]) for (const [source, stdout] of cases) {
  test(`${runtime} indexed printf conversion: ${source}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem(), env: {LC_ALL: "C"}}).use(agentCommands())
      : new RustWasmBash({cwd: "/", env: {LC_ALL: "C"}, forceNative: true});
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
