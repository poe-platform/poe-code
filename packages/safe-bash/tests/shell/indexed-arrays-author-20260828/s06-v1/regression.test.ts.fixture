import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory.js";
import { parseShell } from "../../../../src/shell/parser.js";
import { cases, script } from "./cases.js";

for (const entry of cases) {
  test(`S06 control: ${entry.id}`, { timeout: 5000 }, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const calls: string[][] = [];
    const statuses: string[][] = [];
    shell.register({ name: "__array_value", execute(context) { calls.push([...context.args]); return { exitCode: 0 }; } });
    shell.register({ name: "__array_status", execute(context) { statuses.push([...context.args]); return { exitCode: 0 }; } });
    try {
      const result = await shell.exec(script(entry));
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(statuses, [["0"]]);
      assert.deepEqual(calls, [entry.expected]);
    } finally { await shell.dispose(); }
  });
}

test("S06 private provenance preserves public word parts", { timeout: 5000 }, () => {
  const word = (source: string) => {
    const command = parseShell(source).lists[0]!.pipelines[0]!.commands[0]!;
    assert(command.kind === "simple");
    return command.words[0]!;
  };
  const synthetic = word('"${a[@]}${b[@]}"');
  const explicit = word('"""${a[@]}${b[@]}"');
  assert.deepEqual(synthetic.parts, explicit.parts);
  assert.deepEqual(synthetic.parts[0], { kind: "text", value: "", quoted: true });
  assert.deepEqual(Reflect.ownKeys(synthetic.parts[0]!), ["kind", "value", "quoted"]);
  assert.deepEqual(word('"before${a[@]}after"').parts.filter(part => part.kind === "text"), [
    { kind: "text", value: "before", quoted: true },
    { kind: "text", value: "after", quoted: true },
  ]);
});
