import assert from "node:assert/strict";
import test from "node:test";
import { createStandardCommands, MemoryFileSystem, toByteSource, type CommandContext } from "../../../src/index.js";
import { RegexExecutor as NodeRegexExecutor } from "../../../src/commands/regex-execution/client.js";
import { RegexExecutionError, exprMatchCeilings, type GrepDescriptor, type SearchDescriptor } from "../../../src/commands/regex-execution/protocol.js";

const grep: GrepDescriptor = { kind: "grep", patterns: ["a"], fixed: false, extended: true, insensitive: false, whole: false, word: false };
const rg: SearchDescriptor = { kind: "rg", patterns: ["a"], fixed: false, case: "sensitive", whole: false, word: false, nullData: false };

test("actual regex worker admits exactly 100000 ranges in one row", async () => {
  const session = new NodeRegexExecutor().open(new AbortController().signal);
  const bytes = Buffer.alloc(100_000, 97);
  try {
    const result = await session.run(grep, [{ bytes, all: true, terminated: true }]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.length, 100_000);
    assert.deepEqual(result[0]![0], { start: 0, end: 1 });
    assert.deepEqual(result[0]!.at(-1), { start: 99_999, end: 100_000 });
    assert.equal(bytes.length, 100_000, "request transfer must not detach borrowed input");
    assert.equal(bytes[99_999], 97);
  } finally { await session.close(); }
});

test("actual regex worker refuses 100001 row ranges through the MATCH error route", async () => {
  const session = new NodeRegexExecutor().open(new AbortController().signal);
  try {
    await assert.rejects(session.run(grep, [{ bytes: Buffer.alloc(100_001, 97), all: true, terminated: true }]),
      error => error instanceof RegexExecutionError && error.code === "MATCH" && /matches.*limit exceeded/u.test(error.message));
  } finally { await session.close(); }
});

test("actual regex worker admits exactly 100000 reply ranges across two rows", async () => {
  const session = new NodeRegexExecutor().open(new AbortController().signal);
  try {
    const result = await session.run(rg, [50_000, 50_000].map(length => ({ bytes: Buffer.alloc(length, 97), all: true, terminated: true })));
    assert.deepEqual(result.map(matches => matches.length), [50_000, 50_000]);
    for (const matches of result) assert.deepEqual(matches.at(-1), { start: 49_999, end: 50_000 });
  } finally { await session.close(); }
});

test("actual regex worker refuses cumulative 50001 plus 50001 ranges without truncation", async () => {
  const session = new NodeRegexExecutor().open(new AbortController().signal);
  try {
    await assert.rejects(session.run(rg, [50_001, 50_001].map(length => ({ bytes: Buffer.alloc(length, 97), all: true, terminated: true }))),
      error => error instanceof RegexExecutionError && error.code === "MATCH" && /matches per reply limit exceeded/u.test(error.message));
    assert.deepEqual(await session.run(rg, [{ bytes: Buffer.from("a"), all: true, terminated: true }]), [[{ start: 0, end: 1 }]]);
  } finally { await session.close(); }
});

test("actual regex worker preserves empty, non-all and unrelated expr requests", async () => {
  const session = new NodeRegexExecutor().open(new AbortController().signal);
  try {
    assert.deepEqual(await session.run(grep, []), []);
    assert.deepEqual(await session.run(grep, [{ bytes: Buffer.alloc(0), all: true, terminated: true }]), [[]]);
    assert.deepEqual(await session.run(grep, [{ bytes: Buffer.alloc(100_001, 97), all: false, terminated: true }]), [[{ start: 0, end: 1 }]]);
    const expr = await session.matchExpr({ kind: "expr-match", pattern: Buffer.from("a"), profile: "byte", limits: exprMatchCeilings }, Buffer.from("abc"));
    assert.equal(expr.matched, true);
    assert.deepEqual(expr.overall, { start: 0, end: 1 });
  } finally { await session.close(); }
});

for (const length of [100_000, 100_001]) {
  test(`public standard grep -oc applies the worker range cap at ${length}`, async () => {
    const command = createStandardCommands().find(definition => definition.name === "grep")!;
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: "grep", args: ["-oc", "a"], fs: new MemoryFileSystem(), cwd: "/", env: {},
      signal: new AbortController().signal, stdinIsDefault: false, stdin: toByteSource(Buffer.alloc(length, 97)),
      stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(); } },
      stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
    };
    const result = await command.execute(context);
    assert.equal(result.exitCode, length === 100_000 ? 0 : 2);
    assert.equal(stdout, length === 100_000 ? "1\n" : "");
    if (length === 100_000) assert.equal(stderr, "");
    else assert.match(stderr, /matches.*limit exceeded/u);
  });
}
