import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) {
  test(`${runtime} Bash 5.3 readonly destination preserves earlier assignments and consumes the record`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec('readonly locked=old; read first "locked[0]" last; printf "continued:%s <%s> <%s> <%s>\\n" "$?" "$first" "$locked" "$last"; read tail; printf "tail:%s\\n" "$tail"', {stdin: "one two three\nTAIL\n"});
      assert.equal(result.stdout, "continued:2 <one> <old> <>\ntail:TAIL\n");
      assert.equal(result.stderr, "shell: line 1: locked: readonly variable\n");
      assert.equal(result.exitCode, 0);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}

const cases = [
  ["writable indexed destination", 'items=(old keep); read "items[0]"; printf "%s|%s|%s" "$?" "${items[0]}" "${items[1]}"', "0|one two three|keep", ""],
  ["writable subscript evaluated once", 'items=(old keep); i=0; read "items[i++]"; printf "%s|%s|%s|%s" "$?" "$i" "${items[0]}" "${items[1]}"', "0|1|one two three|keep", ""],
  ["readonly subscript evaluated once", 'readonly -a items=(old keep); i=0; read "items[i++]"; printf "%s|%s|%s|%s" "$?" "$i" "${items[0]}" "${items[1]}"', "1|1|old|keep", "shell: line 1: items: readonly variable\n"],
  ["readonly first indexed destination", 'readonly -a items=(old keep); read "items[0]" last; printf "%s|%s|%s" "$?" "${items[0]}" "$last"', "2|old|", "shell: line 1: items: readonly variable\n"],
  ["readonly last indexed destination", 'readonly -a items=(old keep); read first "items[0]"; printf "%s|%s|%s" "$?" "$first" "${items[0]}"', "1|one|old", "shell: line 1: items: readonly variable\n"],
  ["readonly associative destination", 'declare -A items=([key]=old); readonly items; read first "items[key]" last; printf "%s|%s|%s|%s" "$?" "$first" "${items[key]}" "$last"', "2|one|old|", "shell: line 1: items: readonly variable\n"],
  ["readonly nameref destination", 'readonly -a items=(old keep); declare -n ref="items[0]"; read first ref last; printf "%s|%s|%s|%s" "$?" "$first" "${items[0]}" "$last"', "2|one|old|", "shell: line 1: items: readonly variable\n"],
  ["malformed first target preserves input", 'read "items[0"; printf "%s|" "$?"; IFS= read -r line; printf "%s" "$line"', "1|one two three", "shell: line 1: read: `items[0': not a valid identifier\n"],
];
for (const runtime of ["TypeScript", "Rust"]) for (const [name, source, stdout, stderr] of cases) {
  test(`${runtime} read ${name}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const shell = runtime === "TypeScript" ? new Shell({fs: createMemoryFileSystem()}).use(agentCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const result = await shell.exec(source, {stdin: "one two three\nTAIL\n"});
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, stderr);
      assert.equal(result.exitCode, 0);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}

