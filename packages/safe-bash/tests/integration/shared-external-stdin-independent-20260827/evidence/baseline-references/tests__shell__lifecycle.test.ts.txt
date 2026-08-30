import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

for (const scenario of ["cleanup-abort", "cleanup-late-rejection", "shared-delayed-generator", "shared-serialized", "shared-repeated-cancellation", "shared-abandoned-rejection", "shared-retained-rejection", "owned-cleanup-abort", "busy-loop-abort"]) {
  test(`hard-timeout lifecycle regression: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./lifecycle-probe.ts", import.meta.url)), scenario], {
      timeout: 3000, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, `${scenario}: ${result.error?.message}`);
    assert.equal(result.signal, null, `${scenario}: child terminated by ${result.signal}`);
    assert.equal(result.status, 0, `${scenario}: ${result.stderr}`);
    assert.match(result.stdout, /: passed/u);
  });
}

test("write-only redirects never read and retain independent/duplicated offsets", async () => {
  for (const [script, expected] of [
    ["say replacement >file", "replacement\n"],
    ["both >file 2>file", "err\n"],
    ["both >file 2>&1", "out\nerr\n"],
    ["both >file 2>>file", "out\nerr\n"],
    ["say appended >>file", "oldappended\n"],
  ]) {
    const { shell, fs } = setup();
    await fs.writeFile("/file", new TextEncoder().encode("old"));
    await fs.chmod("/file", 0o200);
    let reads = 0;
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (...args) => { reads++; return readFile(...args); };
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    assert.equal(reads, 0, script);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await readFile("/file")), expected, script);
  }
});

test("offset and append descriptors interleave correctly without reading files", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "interleave", async execute({ stdout, stderr }) {
    await writeText(stdout, "abcdef");
    await writeText(stderr, "XY");
    await writeText(stdout, "!");
    await writeText(stderr, "Z");
    return { exitCode: 0 };
  } });
  await fs.writeFile("/file", new Uint8Array());
  await fs.chmod("/file", 0o200);
  for (const [script, expected] of [
    ["interleave >file 2>file", "XYZdef!"],
    ["interleave >file 2>>file", "abcdef!YZ"],
    ["interleave >>file 2>file", "XYZdef!"],
    ["interleave >file 2>&1", "abcdefXY!Z"],
    ["{ say first; say new >file; say last; } >file", "new\n\0\0last\n"],
  ]) {
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), expected, script);
    await fs.chmod("/file", 0o200);
  }
});

test("cancelled queued readers cannot bypass an active shared read", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maximum = 0;
  let position = 0;
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      active++;
      maximum = Math.max(maximum, active);
      const index = position++;
      try { if (index === 0) await gate; return { value: new Uint8Array([65 + index]), done: false }; }
      finally { active--; }
    },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const budget = new Budget(defaultLimits);
  const owner = new ShellInput(source, budget);
  const controller = new AbortController();
  const first = new ShellInput(owner, budget);
  const cancelled = new ShellInput(owner, budget, controller.signal);
  const third = new ShellInput(owner, budget);
  const firstRead = first.next();
  const secondRead = cancelled.next();
  const thirdRead = third.next();
  controller.abort(new Error("cancel queued read"));
  await assert.rejects(secondRead, /cancel queued read/u);
  await cancelled.close();
  assert.equal(returned, 0);
  release();
  assert.deepEqual([...(await firstRead).value!], [65]);
  assert.deepEqual([...(await thirdRead).value!], [66]);
  assert.equal(maximum, 1);
  await first.close();
  await third.close();
  assert.equal(returned, 0);
  await owner.close();
  assert.equal(returned, 1);
});

test("input errors still close their owned iterator exactly once", async () => {
  const { shell } = setup();
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new Error("read failed"); },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const result = await shell.exec("pass", { stdin });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /read failed/u);
  assert.equal(returned, 1);
});
