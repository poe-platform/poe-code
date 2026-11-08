import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { streamCommands } from "../../src/commands/streams.js";
import { basicCommands } from "../../src/commands/basic.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { setup } from "./helpers.js";
import { portableTrapExtension } from "../../src/shell/trap.js";

for (const [input, expected] of [["010", "0:8"], ["08", "1:0"], ["1e2", "1:0"], ["0o10", "1:0"], ["0b10", "1:0"], ["10", "0:10"]]) {
  test(`positional arithmetic uses Bash integers: ${input}`, async () => {
    const { shell } = setup();
    for (const command of basicCommands()) shell.register(command);
    try {
      const result = await shell.exec(`acc=0; f() { (( acc += $1 )); }; f ${input} 2>/dev/null; echo "$?:$acc"`);
      assert.equal(result.stdout, `${expected}\n`);
    } finally { await shell.dispose(); }
  });
}
for (const [name, source, expected] of [
  ["octal accumulator", 'acc=010; f() { (( acc += $1 )); }; f 1; echo "$acc"', "9"],
  ["locale change", 'count=0; a=x; b=x; f() { (( count = count + 1 )); [[ $a == $b ]]; }; g() { f 1; LC_ALL=C; f 1; }; g 1; echo "$count"', "2"],
  ["unset", 'count=0; f() { (( count = count + 1 )); unset x; }; f 1; echo "$count"', "1"],
  ["export", 'count=0; f() { (( count = count + 1 )); export x=1; }; f 1; echo "$count"', "1"],
  ["array assignment", 'count=0; a=(1 2); f() { (( count = count + 1 )); a=3; }; f 1; echo "$count"', "1"],
  ["local array", 'count=0; a=(1 2); f() { (( count = count + 1 )); local a=3; }; f 1; echo "$count"', "1"],
  ["collation", 'count=0; a=x; b=y; f() { (( count = count + 1 )); [[ $a < $b ]]; }; f 1; echo "$count"', "1"],
  ["unicode trim", 'count=0; s=ab; f() { (( count = count + 1 )); [[ ${s#?} == b ]]; }; f 1; s=αb; f 1; echo "$count"', "2"],
  ["group eligibility changes", 'count=0; { (( count = count + 1 )); a=(1 2); a=3; }; echo "$count"', "1"],
  ["eval eligibility changes", 'count=0; eval "(( count = count + 1 )); a=(1 2); a=3"; echo "$count"', "1"],
  ["integer attribute", 'declare -i acc=010; f() { (( acc += $1 )); }; f 1; echo "$acc"', "9"],
] as const) {
  test(`compound functions do not replay: ${name}`, async () => {
    const { shell } = setup({ env: { LC_ALL: "en_US.UTF-8" } });
    for (const command of basicCommands()) shell.register(command);
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `${expected}\n`);
    } finally { await shell.dispose(); }
  });
}
for (const [source, expected] of [
  ['x=$(printf "a\\n" | tr a b); echo "x=$x"', "x=b\n"],
  ['x=$(if true; then echo hi; fi); echo "x=$x"', "x=hi\n"],
  ['trap "echo bye" EXIT; trap -p', "trap -- 'echo bye' EXIT\nbye\n"],
  ['x=$(printf "b\\na\\nb\\n" | sort -u); echo "$x"', "a\nb\n"],
  ['x=é; eval "echo $x"', "é\n"],
  ['x=$(printf "\ufeffé\\n" | tr x y); echo "$x"', "\ufeffé\n"],
] as const) {
  test(`shell runs without global Buffer: ${source}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), ...(source.startsWith("trap") ? { extensions: [portableTrapExtension()] } : {}) });
    shell.use({ name: "portable-fixture", setup(host) {
      for (const command of [...basicCommands(), ...streamCommands(), textCommands().find(command => command.name === "sort")!]) host.commands.register(command);
    } });
    const buffer = globalThis.Buffer;
    try {
      Reflect.deleteProperty(globalThis, "Buffer");
      const result = await shell.exec(source);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { globalThis.Buffer = buffer; await shell.dispose(); }
  });
}
