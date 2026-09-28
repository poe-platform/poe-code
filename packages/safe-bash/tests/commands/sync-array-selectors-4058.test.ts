import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases: [string, string, string][] = [];
for (const [selector, value] of [["s[0]", "hello"], ["s[1]", ""], ["s[*]", "hello"], ["s[@]", "hello"], ["!s[*]", "0"], ["!s[@]", "0"]]) {
  cases.push([`scalar ${selector}`, `s=hello; for i in 1 2; do echo "\${${selector}}"; done`, `${value}\n${value}\n`]);
  cases.push([`unset ${selector}`, `for i in 1 2; do echo "\${${selector}}"; done`, "\n\n"]);
}
for (const [index, value] of [["-1", "c"], ["0x1", "b"], ["01", "b"], ["2#10", "c"], ["0+1+1", "c"], ["(0)", "a"]]) {
  cases.push([`arithmetic ${index}`, `arr=(a b c); for i in 1 2; do echo "\${arr[${index}]}"; done`, `${value}\n${value}\n`]);
}
for (const [operator, setup] of [[":-", "arr=()"], ["-", "arr=()"], [":+", "arr=(a)"], ["+", "arr=(a)"]]) {
  cases.push([`command alternate ${operator}`, `${setup}; for i in 1 2; do echo "\${arr[0]${operator}$(echo alternate)}"; done`, "alternate\nalternate\n"]);
}
cases.push(["nested alternate", 'arr=(); s=hello; for i in 1 2; do echo "${arr[0]:-${s[0]}}"; done', "hello\nhello\n"]);
cases.push(["while loop", 's=hello; i=0; while ((i<2)); do ((i++)); echo "${s[0]}"; done', "hello\nhello\n"]);
cases.push(["arithmetic for loop", 'arr=(a b c); for ((i=0;i<2;i++)); do echo "${arr[-1]}"; done', "c\nc\n"]);
cases.push(["assignment preserves values and effects", 's=hello; n=0; for i in 1 2; do ((n++)); value="${s[0]}"; done; echo "$n:$value:$s"', "2:hello:hello\n"]);
cases.push(["binding changes after preflight", 'arr=(a); for i in 1 2; do unset arr; arr=scalar; echo "${arr[0]}"; done', "scalar\nscalar\n"]);
cases.push(["index changes after preflight", 'arr=(a b c); j=0; for i in 1 2; do j=-1; echo "${arr[j]}"; done', "c\nc\n"]);

for (const [name, source, stdout] of cases) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
    try {
      const result = await shell.exec(source);
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
