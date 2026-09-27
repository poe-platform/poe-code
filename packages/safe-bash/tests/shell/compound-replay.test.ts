import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";

const cases: [string, string, string][] = [
  ["isolated unsupported for body", 'for item in a b; do echo "$item"; say "$item"; done | pass', "a\na\nb\nb\n"],
  ["isolated unsupported arithmetic-for body", 'for ((j=0; j<2; j++)); do echo "$j"; say "$j"; done | pass', "0\n0\n1\n1\n"],
  ["while condition break", 'while break; do echo body; done; echo "status:$?"', "status:0\n"],
  ["until condition break", 'until break; do echo body; done; echo "status:$?"', "status:0\n"],
  ["nested condition break", 'for outer in a b; do while break 2; do echo wrong; done; echo wrong; done; echo done', "done\n"],
  ["nested condition continue", 'count=0; for outer in a b; do until continue 2; do echo wrong; done; ((count++)); done; echo "$count"', "0\n"],
  ["condition continue", 'i=0; while ((i++ < 3)) && continue; do echo body; done; echo "$i"', "4\n"],
  ["arithmetic-for beyond sync cutoff", 'sum=0; for ((i=0; i<4100; i++)); do ((sum++)); done; echo "$i $sum"', "4100 4100\n"],
  ["while beyond sync cutoff", 'i=0; sum=0; while ((i++ < 4100)); do ((sum++)); done; echo "$i $sum"', "4101 4100\n"],
  ["array created before for in group", '{ arr=(10 20); for arr in a b; do echo "${arr[*]}"; done; }', "a 20\nb 20\n"],
  ["array created before for variable", 'f() { arr=(10 20); for arr in a b; do echo "${arr[*]}"; done; }; f', "a 20\nb 20\n"],
];
for (const declaration of ["local", "declare", "typeset"]) {
  for (const flag of ["-a", "-A"]) {
    cases.push([`${declaration} ${flag} in function`, `count=0; f() { ((count++)); echo "run:$count"; ${declaration} ${flag} arr; ${flag === "-a" ? "arr=(1 2)" : "arr[k]=v"}; }; f; echo "final:$count"`, "run:1\nfinal:1\n"]);
  }
}
for (const operation of ['[[ -v "arr[i]" ]]', '[[ -v "arr[-1]" ]]', 'unset "arr[i]"', 'unset "arr[0]"']) {
  cases.push([`${operation} in function`, `arr=(a b); i=0; count=0; f() { local -a arr=(a b); ((count++)); echo "run:$count"; ${operation}; }; f; echo "final:$count"`, "run:1\nfinal:1\n"]);
  cases.push([`${operation} in loop`, `arr=(a b); i=0; count=0; for item in a b; do ((count++)); echo "run:$count"; ${operation}; done; echo "final:$count"`, "run:1\nrun:2\nfinal:2\n"]);
  cases.push([`${operation} in untyped function`, `arr=(a b); i=0; count=0; f() { ((count++)); echo "run:$count"; ${operation}; }; f; echo "final:$count"`, "run:1\nfinal:1\n"]);
}
for (const [name, source, expected] of cases) {
  test(name, async () => {
    const { shell } = setup();
    shell.register(basicCommands().find(command => command.name === "echo")!);
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
