import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

// Pinned against Darwin jq-1.7.1-apple with LC_ALL=C.
const strings: readonly [string, number[], number][] = [
  ["é🙂", [233, 128578], 6],
  ["", [], 0],
  ["\0\u007f\u0080\u07ff\u0800\uffff\u{10ffff}", [0, 127, 128, 2047, 2048, 65535, 1114111], 16],
  ["e\u0301", [101, 769], 3],
];

for (const [filter, limits, value, limit] of [
  ["explode", { maxCollectionSize: 2 }, "abc", "maxCollectionSize"],
  ["explode", { maxValueBytes: 12 }, "🙂🙂", "maxValueBytes"],
  ["utf8bytelength", { maxSteps: 100 }, "a".repeat(200), "maxSteps"],
] as const) test(`jq ${filter} enforces ${limit}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ structured: { limits } }));
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin: `${JSON.stringify(value)}\n` });
    assert.equal(result.exitCode, 5);
    assert.ok(result.stderr.includes(`${limit} limit exceeded`));
  } finally { await shell.dispose(); }
});

for (const [value, points, bytes] of strings) test(`jq Unicode builtins on ${JSON.stringify(value)}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("jq -c '[length,explode,utf8bytelength]'", { stdin: `${JSON.stringify(value)}\n` });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      exitCode: 0, stdout: `${JSON.stringify([points.length, points, bytes])}\n`, stderr: "",
    });
  } finally { await shell.dispose(); }
});

for (const [value, description] of [[null, "null (null)"], [1, "number (1)"], [true, "boolean (true)"], [[], "array ([])"], [{}, "object ({})"]] as const) {
  for (const name of ["explode", "utf8bytelength"]) test(`jq ${name} rejects ${description}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(`jq -c '${name}'`, { stdin: `${JSON.stringify(value)}\n` });
      assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        exitCode: 5, stdout: "", stderr: `jq: error (at <stdin>:1): ${name === "explode" ? "explode input must be a string" : `${description} only strings have UTF-8 byte length`}\n`,
      });
    } finally { await shell.dispose(); }
  });
}
