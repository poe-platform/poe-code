import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createEncodingCommands } from "../../src/commands/bytes/encoding/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { createStreamInspectionCommands } from "../../src/commands/stream-inspection/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  ["tac one unterminated record before wc", "out=$(printf a | tac | wc -c)", "<1>\n"],
  ["tac unterminated record", "out=$(printf 'a\\nb' | tac)", "<ba>\n"],
  ["nl section delimiter", "out=$(printf '\\\\:\\na\\n' | nl)", "<\n       a>\n"],
  ["jq multiline input", `out=$(printf '{\n"a":1\n}\n' | jq .a)`, "<1>\n"],
  ["base64 unpadded input", "out=$(printf YQ | base64 -d)", "<a>\n"],
  ["tr unsupported sync set", "out=$(printf abc | tr '[:lower:]' '[:upper:]')", "<ABC>\n"],
  ["prefixed array fields", 'arr=("p:${!pre@}"); out="${#arr[@]}:${arr[0]}:${arr[1]}"', "<2:p:pre_a:pre_b>\n"],
  ["prefixed for fields", 'count=0; for k in "p:${!pre@}"; do count=$((count+1)); done; out="$count:$k"', "<2:pre_b>\n"],
  ["prefixed and suffixed array fields", 'arr=("p:${!pre@}:s"); out="${#arr[@]}:${arr[0]}:${arr[1]}"', "<2:p:pre_a:pre_b:s>\n"],
  ["empty IFS scalar separators", 'IFS=; x="${!pre@}"; y="${!pre*}"; out="$x/$y"', "<pre_a pre_b/pre_apre_b>\n"],
  ["at scalar separator", 'IFS=:; x="${!pre@}"; y="${!pre*}"; out="$x/$y"', "<pre_a:pre_b/pre_a:pre_b>\n"],
  ["numeric plus key", `out=$(sort -n <<< $'+10\n2\n1')`, "<+10\n1\n2>\n"],
] as const;
for (const [name, body, expected] of cases) {
  for (const loop of [false, true]) test(`${name} ${loop ? "loop" : "single"}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createEncodingCommands(), ...createStructuredCommands(), ...createStreamFormatCommands(), ...createStreamInspectionCommands()]) });
    try {
      const result = await shell.exec(`pre_a=1; pre_b=2; ${loop ? `for ((i=1;i<=10;i++)); do ${body}; done` : body}; printf '<%s>\\n' "$out"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}
test("unset local retains assigned saved outer prefix name", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createEncodingCommands(), ...createStructuredCommands(), ...createStreamFormatCommands(), ...createStreamInspectionCommands()]) });
  try {
    const result = await shell.exec('pre_a=outer; pre_b=2; f() { local pre_a; unset pre_a; for ((i=1;i<=10;i++)); do x="${!pre@}"; done; printf "<%s>\\n" "$x"; }; f');
    assert.equal(result.stdout, "<pre_a pre_b>\n");
  } finally { await shell.dispose(); }
});
