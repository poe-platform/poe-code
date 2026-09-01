import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { diffPatchCommands, type DiffPatchOptions } from "../../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../../src/shell/index.js";
import { contents, filesystem, labels, run } from "./helpers.js";

for (const context of [0, 1, 2, 3]) for (let gap = 0; gap <= 8; gap++) {
  test(`context merging exact boundary C${context}/gap${gap}`, async () => {
    const between = Array.from({ length: gap }, (_, index) => `unique-between-${index}\n`).join("");
    const old = `prefix\nold-first\n${between}old-second\nsuffix\n`;
    const next = `prefix\nnew-first\n${between}new-second\nsuffix\n`;
    const args = ["-C", String(context), ...labels, "old", "new"];
    const expectedHunks = gap <= context * 2 ? 1 : 2;
    const result = await run("diff", args, { files: { old, new: next } });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout.split("***************\n").length - 1, expectedHunks, "independent hunk boundary expectation");
  });
}

const staticRanges = [
  { old: "", next: "x\n", expected: "0a1\n> x\n" },
  { old: "x\n", next: "", expected: "1d0\n< x\n" },
  { old: "a\nb\nc\n", next: "new\n", expected: "1,3c1\n< a\n< b\n< c\n---\n> new\n" },
  { old: "old", next: "new", expected: "1c1\n< old\n\\ No newline at end of file\n---\n> new\n\\ No newline at end of file\n" },
];
for (const [index, entry] of staticRanges.entries()) test(`independent static normal range ${index}`, async () => {
  const result = await run("diff", ["old", "new"], { files: { old: entry.old, new: entry.next } });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, entry.expected);
});

const limits: readonly DiffPatchOptions[] = [
  { maxInputBytes: 3 }, { maxOutputBytes: 6 }, { maxLines: 2 },
  { maxMatrixCells: 1 }, { maxWork: 3 }, { maxHunks: 1 },
];
for (const flags of [[], ["-C0"]]) for (const options of limits) {
  test(`format budget atomic ${flags[0] ?? "normal"}/${JSON.stringify(options)}`, async () => {
    const old = "old-one\nanchor\nold-two\n";
    const next = "new-one\nanchor\nnew-two\n";
    const result = await run("diff", [...flags, "-w", "old", "new"], { files: { old, new: next }, options });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /limit|maxBytes/u);
    assert.equal(Buffer.from(await result.fs.readFile("/work/old")).toString("utf8"), old);
  });
}

for (const flags of [[], ["-C3"]]) {
  test(`format cancellation during normalized comparison ${flags[0] ?? "normal"}`, async () => {
    const controller = new AbortController();
    const reason = new Error("format cancellation sentinel");
    let writes = 0;
    const old = Array.from({ length: 400 }, (_, index) => `old-${index} \t value\n`).join("");
    const next = Array.from({ length: 400 }, (_, index) => `new-${index}  value\n`).join("");
    const fs = await filesystem({ old, new: next });
    const timer = setTimeout(() => controller.abort(reason), 1);
    try {
      await assert.rejects(run("diff", [...flags, "-w", "old", "new"], {
        fs, signal: controller.signal, stdout: { async write() { writes++; } },
      }), error => error === reason);
      assert.equal(writes, 0);
    } finally { clearTimeout(timer); }
  });

  test(`format cancellation interrupts blocked stdout ${flags[0] ?? "normal"}`, { timeout: 2000 }, async () => {
    const controller = new AbortController();
    const reason = new Error("blocked output cancellation");
    let entered = false;
    const result = run("diff", [...flags, "old", "new"], {
      files: { old: "old\n", new: "new\n" }, signal: controller.signal,
      stdout: { write() { entered = true; controller.abort(reason); return new Promise<void>(() => {}); } },
    });
    await assert.rejects(result, error => error === reason);
    assert.equal(entered, true);
    await delay(1);
  });
}

for (const format of ["normal", "context"]) test(`Shell plugin ${format} diff-to-patch pipeline`, async () => {
  const fs = await filesystem({ old: "head\nold\nlast", new: "head\nnew\nlast", target: "head\nold\nlast" });
  const shell = new Shell({ fs, cwd: "/work" }).use(diffPatchCommands());
  const script = format === "normal" ? "diff old new | patch target" : "diff -c --label target --label target old new | patch";
  const result = await shell.exec(script);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(await contents(fs), "head\nnew\nlast");
});

for (const [format, input] of [
  ["normal", "1c1\n< old\n---\n> replacement\n"],
  ["context", "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! replacement\n"],
] as const) for (const options of [{ maxInputBytes: 4 }, { maxOutputBytes: 2 }]) {
  test(`patch atomic extension format budget ${format}/${JSON.stringify(options)}`, async () => {
    const result = await run("patch", ["--atomic", "target"], { files: { target: "old\n" }, input, options });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /limit|maxBytes/u);
    assert.equal(await contents(result.fs), "old\n");
  });
}
