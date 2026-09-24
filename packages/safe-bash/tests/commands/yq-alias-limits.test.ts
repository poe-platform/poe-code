import assert from "node:assert/strict";
import { test } from "node:test";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createYqCommand, type YqCommandsOptions } from "../../src/commands/yq/index.js";
import { copyAlias, YqLedger, resolveYqLimits } from "../../src/commands/yq/accounting.js";
import { createYqQuerySession } from "../../src/commands/structured/query-core.js";

for (const [limits, code] of [
  [{ maxAliasReferences: 0 }, "LIMIT_MAX_ALIAS_REFERENCES"],
  [{ maxDocumentNodes: 2 }, "LIMIT_MAX_DOCUMENT_NODES"],
  [{ maxValueBytes: 4 }, "LIMIT_MAX_VALUE_BYTES"],
] as const) test(`alias projection rejects ${code} before reserving clone work`, async context => {
  const session = createYqQuerySession({ signal: new AbortController().signal });
  const reserve = context.mock.method(session.ownedWork, "reserve");
  try {
    const ledger = new YqLedger(resolveYqLimits(limits));
    await assert.rejects(copyAlias(["x", "x"], ledger, session.ownedWork), { code });
    assert.equal(reserve.mock.callCount(), 0);
    assert.equal(ledger.aliases, 0);
    assert.equal(ledger.documentNodes, 0);
  } finally { await session.close(); }
});

test("work reservation rejects an alias clone before committing the projection", async () => {
  const session = createYqQuerySession({ signal: new AbortController().signal, limits: { maxSteps: 8 } });
  const ledger = new YqLedger();
  try {
    await assert.rejects(copyAlias(["x", "x"], ledger, session.ownedWork), { message: "maxSteps limit exceeded" });
    assert.equal(ledger.aliases, 0);
  } finally { await session.close(); }
});

test("host limits are finite, validated and captured independently", () => {
  for (const value of [Infinity, NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createYqCommand({ limits: { maxSteps: value } }), TypeError);
  }
  assert.throws(() => createYqCommand({ limits: { unknown: 1 } } as never), TypeError);
  assert.doesNotThrow(() => createYqCommand({ limits: { maxAliasReferences: 0 } }));
});

async function run(input: string, options: YqCommandsOptions = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args: [".selected"], stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(bytes); } },
    stderr: { async write(bytes) { stderr.push(bytes); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
  const result = await createYqCommand(options).execute(context);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

test("unselected doubling aliases are rejected by the default expansion budget", async () => {
  const lines = ['selected: ok', 'a0: &a0 [x, x]'];
  for (let level = 1; level <= 14; level++) lines.push(`a${level}: &a${level} [*a${level - 1}, *a${level - 1}]`);
  const result = await run(lines.join("\n"));
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /LIMIT_MAX_DOCUMENT_NODES/);
});

for (const [limits, code] of [
  [{ maxAliasReferences: 0 }, "LIMIT_MAX_ALIAS_REFERENCES"],
  [{ maxDocumentNodes: 5 }, "LIMIT_MAX_DOCUMENT_NODES"],
  [{ maxValueBytes: 30 }, "LIMIT_MAX_VALUE_BYTES"],
  [{ maxSteps: 10 }, "LIMIT_MAX_STEPS"],
] as const) test(`host ${code} applies before query selection`, async () => {
  const input = "selected: ok\na: &a [x, x]\nb: [*a, *a]";
  const result = await run(input, { limits });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, new RegExp(code));
  assert.deepEqual(await run(input), { exitCode: 0, stdout: '"ok"\n', stderr: "" });
});

test("command captures host limits before later mutation", async () => {
  const limits = { maxAliasReferences: 0 };
  const command = createYqCommand({ limits });
  limits.maxAliasReferences = 100;
  const bytes: Uint8Array[] = [];
  const result = await command.execute({
    command: "yq", args: [".selected"], stdin: toByteSource("selected: ok\na: &a x\nb: *a"),
    stdout: { async write() {} }, stderr: { async write(chunk) { bytes.push(chunk); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 5);
  assert.match(Buffer.concat(bytes).toString(), /LIMIT_MAX_ALIAS_REFERENCES/);
});
