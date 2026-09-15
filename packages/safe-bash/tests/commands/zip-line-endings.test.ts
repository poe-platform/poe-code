import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import { toByteSource } from "../../src/contracts/index.js";

const captures = JSON.parse(readFileSync(new URL("./fixtures/zip-to-crlf-infozip.json", import.meta.url), "utf8")) as { name: string; input: string; output: string }[];
for (const method of ["-0", "-6"]) {
  for (const capture of captures) {
    test(`zip -l ${method} native ${capture.name} payload`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/text", Buffer.from(capture.input, "hex"));
      const result = await execute("zip", fs, ["-ql", method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout, Buffer.from(capture.output, "hex"));
    });
  }
  const boundary = method === "-0" ? 8192 : 32768;
  for (const offset of [-1, 0, 1]) {
    test(`zip -l ${method} first binary buffer boundary ${offset}`, async () => {
      const fs = await fixture();
      const bytes = Buffer.concat([Buffer.alloc(boundary + offset, 65), Buffer.from([0, 10])]);
      await fs.writeFile("/work/text", bytes);
      const result = await execute("zip", fs, ["-ql", method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = offset < 0 ? bytes : Buffer.concat([bytes.subarray(0, -1), Buffer.from("\r\n")]);
      assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout, expected);
    });
  }
}
for (const flag of ["--to-crlf", "--to-c"]) {
  test(`zip ${flag} converts stdin payload`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", flag, "out.zip", "-"], {}, { stdin: toByteSource("a\nb\n") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await execute("unzip", fs, ["-p", "out.zip", "-"])).stdout.toString(), "a\r\nb\r\n");
  });
}
for (const limits of [{ maxEntryBytes: 3 }, { maxTotalBytes: 3 }]) {
  test(`zip -l rejects converted payload growth ${JSON.stringify(limits)}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/text", Buffer.from("a\n\n"));
    const result = await execute("zip", fs, ["-ql", "out.zip", "text"], { limits });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /payload byte limit exceeded/);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name === "out.zip"), false);
  });
}

test("zip -l preserves stored symlink targets", async () => {
  const fs = await fixture();
  await fs.symlink!("target\n", "/work/link");
  const result = await execute("zip", fs, ["-qly", "out.zip", "link"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "link"])).stdout.toString(), "target\n");
});

test("zip -l leaves unselected existing members unchanged", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/text", Buffer.from("a\n"));
  const before = (await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout;
  assert.equal((await execute("zip", fs, ["-ql", "sample.zip", "text"])).exitCode, 0);
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout, before);
});

test("zip LF conversion rejects cancellation even for empty or binary input", async () => {
  const { zipToCrlf } = await import("../../src/commands/archive/zip/line-endings.js");
  const controller = new AbortController();
  controller.abort(false);
  for (const bytes of [Buffer.alloc(0), Buffer.from([0, 10]), Buffer.from("a\n")]) {
    await assert.rejects(zipToCrlf(bytes, false, 100, controller.signal), error => error === false);
  }
});
