import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";

for (const [operator, expected] of [
  ["*", "a: [2]\nb: 5\n"],
  ["*+", "a: [1, 2]\nb: 5\n"],
  ["*d", "a: [2]\nb: 5\n"],
  ["*?", "a: [2]\n"],
  ["*n", "a: [1]\nb: 5\n"],
] as const) {
  test(`yq eval-all merges files with ${operator}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work", { recursive: true });
    await fs.writeFile("/work/a.yml", new TextEncoder().encode("a: [1]\n"));
    await fs.writeFile("/work/b.yml", new TextEncoder().encode("a: [2]\nb: 5\n"));
    let stdout = "", stderr = "";
    const result = await createYqCommand().execute({
      command: "yq", ...createCommandArguments(["ea", `select(fi == 0) ${operator} select(fi == 1)`, "a.yml", "b.yml"]),
      cwd: "/work", env: {}, fs, signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, { exitCode: 0, stdout: expected, stderr: "" });
  });
}

for (const [expression, input, expected] of [
  ['.left *+ .right', '{"left":{"a":{"items":[1]},"keep":0},"right":{"a":{"items":[2]},"new":5}}', '{"a":{"items":[1,2]},"keep":0,"new":5}'],
  ['.left *d .right', '{"left":[{"a":1},2,3],"right":[{"b":2},4]}', '[{"a":1,"b":2},4,3]'],
  ['.left *d .right', '{"left":[1],"right":[2,3]}', '[2,3]'],
  ['.left *? .right', '{"left":{"a":{"old":1,"keep":0}},"right":{"a":{"old":2,"new":3},"new":5}}', '{"a":{"old":2,"keep":0}}'],
  ['.left *n .right', '{"left":{"a":{"old":1},"empty":null},"right":{"a":{"old":2,"new":3},"empty":5}}', '{"a":{"old":1,"new":3},"empty":5}'],
  ['.left *? .right', '{"left":{"a":null},"right":{"a":{"new":3},"new":5}}', '{"a":{}}'],
  ['.left *n .right', '{"left":{"a":0,"b":false,"c":"","d":[]},"right":{"a":1,"b":true,"c":"x","d":[1]}}', '{"a":0,"b":false,"c":"","d":[]}'],
  ['.left *?+ .right', '{"left":{"a":[1]},"right":{"a":[2],"new":5}}', '{"a":[1,2]}'],
  ['.left *n+ .right', '{"left":{"a":[1]},"right":{"a":[2],"new":5}}', '{"a":[1],"new":5}'],
  ['.left *?d .right', '{"left":[{"a":1},2],"right":[{"b":2},4,5]}', '[{"a":1},4,5]'],
  ['.left *nd .right', '{"left":[{"a":1},2],"right":[{"b":2},4,5]}', '[{"a":1,"b":2},2,5]'],
  ['.left *+d .right', '{"left":[{"a":1},2],"right":[{"b":2},4]}', '[{"a":1,"b":2},4,{"b":2},4]'],
  ['.left *+ .right, .left', '{"left":[1],"right":[2]}', '[1,2]\n[1]'],
  ['[1] + [2] *+ [3]', '{}', '[1,2,3]'],
  ['2 *+ 3 + 1', '{}', '7'],
  ['2 *d 3', '{}', '6'],
  ['2 *? 3', '{}', '6'],
  ['2 *n 3', '{}', '6'],
  ['.left * .right', '{"left":{"a":{"old":1},"items":[1]},"right":{"a":{"new":2},"items":[2]}}', '{"a":{"old":1,"new":2},"items":[2]}'],
  ['.left + .right', '{"left":{"a":{"old":1}},"right":{"a":{"new":2}}}', '{"a":{"new":2}}'],
] as const) {
  test(`yq merge semantics: ${expression} on ${input}`, async () => {
    let stdout = "", stderr = "";
    const result = await createYqCommand().execute({
      command: "yq", ...createCommandArguments(["-o=json", "-I=0", expression]),
      cwd: "/work", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.deepEqual({ exitCode: result.exitCode, stdout, stderr }, { exitCode: 0, stdout: `${expected}\n`, stderr: "" });
  });
}
