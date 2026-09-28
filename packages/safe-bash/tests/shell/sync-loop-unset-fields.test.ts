import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

const cases: [string, string][] = [
  ["unset loop variable removes export and cached value", 'export x=before; for x in {1..2}; do unset x; done; echo "${x-unset}"; x=after; export -p'],
  ["plain unset removes a function without a variable", 'fn() { echo alive; }; unset fn; type -t fn || echo unset'],
  ["plain unset removes the variable before the same-named function", 'fn() { echo alive; }; fn=value; unset fn; type -t fn; unset fn; type -t fn || echo unset'],
  ["plain unset preserves a function when removing an empty array", 'fn() { echo alive; }; fn=(); unset fn; type -t fn'],
  ["plain unset preserves a function when removing an exported declaration", 'fn() { echo alive; }; export fn; unset fn; type -t fn'],
];
for (const header of ["for x in {1..2}", "for ((i=0;i<2;i++))", "i=0; while ((i++<2))"]) {
  for (const allexport of [false, true]) {
    cases.push([`${header} unset and reassign with allexport=${allexport}`, `export y=before; ${allexport ? "set -a;" : ""} ${header}; do unset y; y=new; done; set +a; echo "$y"; export -p`]);
  }
  for (const flag of ["", "-v "]) {
    cases.push([`${header} unset ${flag}function`, `fn() { echo alive; }; ${header}; do unset ${flag}fn; done; type -t fn || echo unset`]);
    cases.push([`${header} unset ${flag}variable sharing function name`, `fn() { echo alive; }; fn=value; ${header}; do unset ${flag}fn; done; type -t fn || echo unset`]);
  }
}
for (const whitespace of ["\\r", "\\v", "\\f"]) {
  for (const words of ["$v", "$(cat /fields)"]) {
    cases.push([`${words} preserves ${whitespace}`, `v=$'${whitespace}foo${whitespace} \\tbar${whitespace}\\n'; printf '%s' "$v" > /fields; out=; for w in ${words}; do out="$out[$w]"; done; printf '%s' "$out"`]);
  }
}
for (const initial of ["x=before", "unset x", "export x=before"]) {
  cases.push([`zero iterations preserve ${initial}`, `${initial}; empty=; set -a; for x in $empty; do :; done; set +a; echo "\${x-unset}"; export -p`]);
}

for (const [name, source] of cases) test(name, async () => {
  // Compare only the named variable's export attribute; unrelated inherited
  // environment entries and export ordering are host-dependent.
  const script = source.replaceAll("export -p", "export -p | grep 'declare -x [xy]=' || true");
  // Feed identical substitution bytes without creating any host files.
  const nativeScript = script.replace('printf \'%s\' "$v" > /fields', ":").replace("cat /fields", 'printf \'%s\' "$v"');
  const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", nativeScript], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
  assert.equal(native.error, undefined);
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { PATH: "/usr/bin:/bin" } });
  shell.use(standardCommands());
  try {
    const result = await shell.exec(script, { stdin: "" });
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
    assert.equal(result.exitCode, native.status);
  } finally { await shell.dispose(); }
});
