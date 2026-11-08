import assert from "node:assert/strict";
import test from "node:test";
import { Runtime } from "../../src/shell/runtime.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { createTableTextCommands } from "../../src/commands/table-text/index.js";

const cases = [
  ["jq round negative halves", "[-0.5,-1.5,-2.5,1.5]\\n", "jq -c 'map(round)'", "[-1,-2,-3,2]"],
  ["jq unicode length", '"😀é"\\n', "jq -c 'utf8bytelength'", "6"],
  ["jq explode", '"😀é"\\n', "jq -c 'explode'", "[128512,233]"],
  ["jq implode invalid", "[65.9,1114112,-1]\\n", "jq -c 'implode'", '"A��"'],
  ["jq implode surrogate", "[55296,56320,65]\\n", "jq -c 'implode'", '"��A"'],
  ["jq floor", " -1.5\\n", "jq -c 'floor'", "-2"],
  ["jq ceil", " -1.5\\n", "jq -c 'ceil'", "-1"],
  ["jq abs", " -1.5\\n", "jq -c 'abs'", "1.5"],
  ["jq transpose", "[[1,2],[3]]\\n", "jq -c 'transpose'", "[[1,3],[2,null]]"],
  ["jq array index", '["a","b","a"]\\n', `jq -c 'index("a")'`, "0"],
  ["jq array rindex", '["a","b","a"]\\n', `jq -c 'rindex("a")'`, "2"],
  ["jq array indices", '["a","b","a"]\\n', `jq -c 'indices("a")'`, "[0,2]"],
  ["jq UTF8 index", '"😀aéa"\\n', `jq -c 'indices("a")'`, "[4,7]"],
  ["awk large exponent int", "1.23456789e21\\n", `awk '{ print int($1) }'`, "1.23457e+21"],
  ["awk exponent int", "1.5e2\\n-2.5e1\\n", `awk '{ print int($1) }'`, "150\n-25"],
  ["awk string ternary", "abc\\n", `awk '{ print $1 == 0 ? "zero" : "nonzero" }'`, "nonzero"],
  ["awk missing field ternary", "abc\\n", `awk '{ print $2 == 0 ? "zero" : "nonzero" }'`, "nonzero"],
  ["awk numeric ternary", "0e2\\n", `awk '{ print $1 == 0 ? "zero" : "nonzero" }'`, "zero"],
  ["awk print redirection", "7\\n", `awk '{ print $1 > 5 ? "gt" : "le" }'`, ""],
  ["paste unicode", "a\\nb\\nc\\n", "paste -d '😀:' - - -", "a😀b:c"],
  ["paste serial unicode", "a\\nb\\nc\\n", "paste -s -d '😀:' -", "a😀b:c"],
] as const;

for (const [name, input, filter, expected] of cases) {
  for (const mode of ["pipeline", "substitution", "loop", "arithmetic-loop"] as const) {
    test(`${name}: ${mode}`, async () => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands(), ...createStructuredCommands(), ...createTableTextCommands()]) });
      try {
        const pipeline = `printf '${input}' | ${filter}`;
        const source = mode === "pipeline" ? pipeline : mode === "substitution"
          ? `out=$(${pipeline}); printf '%s\\n' "$out"`
          : mode === "arithmetic-loop" ? `for ((i=0;i<3;i++)); do out=$(${pipeline}); done; printf '%s\\n' "$out"`
          : `for i in 1 2; do out=$(${pipeline}); done; printf '%s\\n' "$out"`;
        const result = await shell.exec(source);
        assert.equal(result.stdout, mode === "pipeline" && expected === "" ? "" : `${expected}\n`);
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
        if (name === "awk print redirection") {
          assert.equal(new TextDecoder().decode(await fs.readFile("/gt")), "7\n");
        }
      } finally { await shell.dispose(); }
    });
  }
}

test("sync jq UTF-8 length works without the Node Buffer global", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  try {
    Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true });
    const evaluate = Reflect.get(Runtime.prototype, "evalSyncJqPathOps") as (input: unknown, filter: string) => unknown;
    assert.deepEqual(evaluate.call({}, "😀é", "utf8bytelength"), [6]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "Buffer", descriptor);
    else Reflect.deleteProperty(globalThis, "Buffer");
  }
});

for (const [filter, expected] of [['index("a")', [0]], ['rindex("a")', [2]], ['indices("a")', [[0, 2]]]] as const) {
  test(`sync jq array ${filter}`, () => {
    const evaluate = Reflect.get(Runtime.prototype, "evalSyncJqPathOps") as (input: unknown, filter: string) => unknown;
    assert.deepEqual(evaluate.call({}, ["a", "b", "a"], filter), expected);
  });
}

for (const mode of ["pipeline", "substitution", "loop", "arithmetic-loop"] as const) {
  test(`awk nonfinite int preserves the direct command error: ${mode}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]) });
    try {
      const pipeline = `printf '1.5e309\\n' | awk '{ print int($1) }'`;
      const source = mode === "pipeline" ? pipeline : mode === "substitution" ? `out=$(${pipeline})`
        : mode === "loop" ? `for i in 1; do out=$(${pipeline}); done`
        : `for ((i=0;i<1;i++)); do out=$(${pipeline}); done`;
      const result = await shell.exec(source);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /invalid mathematical result in 'int'/);
      assert.notEqual(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
