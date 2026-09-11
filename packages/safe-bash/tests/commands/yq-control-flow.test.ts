import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createYqCommand } from "../../src/commands/yq/index.js";
import { createYqQuerySession } from "../../src/commands/structured/query-core.js";

async function run(source: string, input: string) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args: ["-o", "json", "-c", source], stdin: toByteSource(input),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  const result = await createYqCommand().execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const [source, input, stdout] of [
  ["[.. | numbers]", "values: [1, 2]\nother: 3\n", "[1,2,3]\n"],
  ["reduce .values[] as $item (0; .+$item)", "values: [1, 2, 3]\n", "6\n"],
  ["foreach .values[] as $item (0; .+$item; .,-.)", "values: [1, 2]\n", "1\n-1\n3\n-3\n"],
  ["try .a catch type", "1\n", '"string"\n'],
  ["try fromjson catch type", "'{'\n", '"string"\n'],
  ["reduce .[] as $item (0; .+$item)", "[1, 2]\n---\n[3, 4]\n", "3\n7\n"],
  ["foreach .[] as $item ((0,100); .+$item)", "[1, 2]\n", "1\n3\n101\n103\n"],
  ['reduce . as $item (([],["seed"]); .+[$item])', "[1, 2]\n", '[[1,2]]\n["seed",null]\n'],
] as const) test(`yq shares control-flow semantics: ${source}`, async () => {
  assert.deepEqual(await run(source, input), { status: 0, stdout, stderr: "" });
});

test("yq input parse failures stay outside try", async () => {
  const baseline = await run(".", "[\n");
  assert.notEqual(baseline.status, 0);
  assert.deepEqual(await run("try . catch 99", "[\n"), baseline);
});

test("yq query session closes a suspended foreach and refuses more work", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  try {
    session.compileOnce("foreach range(100) as $item (0; .+$item)");
    const iterator = session.run(null);
    assert.deepEqual(await iterator.next(), { done: false, value: 0 });
    await session.close();
    await assert.rejects(iterator.next(), { message: "yq query session is closed" });
    await assert.rejects(session.run(null).next());
  } finally { await session.close(); }
});
