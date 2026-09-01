import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { standardCommands } from "../../../src/commands/index.js";
import { streamInspectionCommands } from "../../../src/commands/stream-inspection/index.js";
import { numericSyntaxCases } from "./numeric-syntax-cases.js";
import { runFixture } from "./helpers.js";

interface Observation { id: string; fixtureSha256: string; status: number; signal: string | null; stdoutHex: string; stderrHex: string }
const evidence: { native: { observations: Observation[] } } = JSON.parse(readFileSync(new URL("./evidence/fixer-numeric-controls.json", import.meta.url), "utf8"));

for (const specimen of numericSyntaxCases) {
  test(`numeric syntax ${specimen.command}: ${specimen.id}`, async () => {
    const native = evidence.native.observations.find(row => row.id === specimen.id)!;
    assert.equal(native.fixtureSha256, createHash("sha256").update(JSON.stringify(specimen)).digest("hex"));
    assert.equal(native.signal, null);
    assert.equal(native.status, specimen.error === undefined ? 0 : 1);
    if (specimen.error === undefined) assert.equal(native.stderrHex, "");
    else assert.notEqual(native.stderrHex, "");
    const result = await runFixture(specimen, {}, {}, 1);
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdoutHex, native.stdoutHex);
    assert.equal(result.stderr, specimen.error ?? "");
    assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), Object.keys(specimen.files ?? {}).sort());
    for (const [name, hex] of Object.entries(specimen.files ?? {})) {
      assert.equal(Buffer.from(await result.fs.readFile(`/work/${name}`)).toString("hex"), hex);
    }
  });
}

for (const specimen of numericSyntaxCases.filter(candidate => candidate.id.startsWith("reported-"))) {
  test(`${specimen.id}: cancellation identity before input and during output`, async () => {
    for (const duringOutput of [false, true]) {
      const controller = new AbortController();
      const reason = Object.assign(new Error("numeric syntax cancelled"), { code: "ENOENT" });
      if (!duringOutput) controller.abort(reason);
      await assert.rejects(runFixture(specimen, { limits: { maxChunkBytes: 1 } }, {
        signal: controller.signal,
        stdout: { async write() { controller.abort(reason); } },
      }, 1), error => error === reason);
    }
  });

  test(`${specimen.id}: argument, output and work budgets remain enforced`, async () => {
    for (const [label, limits] of [["argument", { maxArgumentBytes: 1 }], ["output", { maxOutputBytes: 1 }], ["step", { maxSteps: 1 }]] as const) {
      const result = await runFixture(specimen, { limits }, {}, 1);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, `${specimen.command}: EFBIG: stream-inspection ${label} limit exceeded\n`);
      assert.ok(Buffer.from(result.stdoutHex, "hex").length <= 1);
    }
  });
}

test("reported numeric syntax dispatches through the actual Shell plugin", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands()).use(streamInspectionCommands());
  try {
    for (const [script, stdoutHex] of [
      ["printf '\\tX\\tY\\t' | expand -2,5", "20205820205920"],
      ["printf 'abc\\tdef\\n' | expand -t 2,+0", "616263206465660a"],
      ["printf 'abcdefg' | fold -3", "6162630a6465660a67"],
      ["printf 'four\\000fives\\000ending' | strings -5", "66697665730a656e64696e670a"],
    ]) {
      const result = await shell.exec(script!);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), stdoutHex);
    }
  } finally { await shell.dispose(); }
});

test("legacy numeric syntax retains the actual shared shell output budget", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 32 } }).use(standardCommands()).use(streamInspectionCommands());
  try {
    await assert.rejects(shell.exec("printf 'a\\tb\\n' | expand -32 | cat"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});
