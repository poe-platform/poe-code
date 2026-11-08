import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { Shell } from "../../../../src/shell/index.js";
import { registry } from "./helpers.js";
import { chunks, fixture, run } from "./helpers.js";

const native = JSON.parse(await readFile(new URL("algorithms-native.json", import.meta.url), "utf8")) as { rows: { args: string[]; stdin: string; files: Record<string, string>; stdout: string; stderr: string; exitCode: number }[] };
for (const row of native.rows) test(`cksum GNU9.7 algorithm bytes: ${row.args.join(" ")}`, async () => {
  for (const width of [1, 7, 65536]) {
    const fs = await fixture(Object.fromEntries(Object.entries(row.files).map(([path, bytes]) => [path, Buffer.from(bytes, "base64")])));
    const result = await run("cksum", row.args, { fs, stdin: chunks(Buffer.from(row.stdin, "base64"), width) });
    assert.equal(Buffer.from(result.stdout).toString("base64"), row.stdout); assert.equal(Buffer.from(result.stderr).toString("base64"), row.stderr); assert.equal(result.exitCode, row.exitCode);
  }
});

test("cksum algorithm errors happen before input effects", async () => {
  let reads = 0;
  const stdin = (async function* () { reads++; yield new Uint8Array([1]); })();
  assert.notEqual((await run("cksum", ["-a", "imaginary"], { stdin })).exitCode, 0);
  assert.equal(reads, 0);
  assert.notEqual((await run("cksum", ["-a", "sha256", "--check", "--zero"], { stdin })).exitCode, 0);
  assert.equal(reads, 0);
});

test("cksum selected algorithms retain blocked-input cancellation", async () => {
  const controller = new AbortController();
  const stdin = (async function* () { await new Promise<void>(() => {}); yield new Uint8Array(); })();
  const rejected = assert.rejects(run("cksum", ["-a", "sha512"], { stdin, signal: controller.signal }), /cancel hash/);
  controller.abort(new Error("cancel hash")); await rejected;
});

const input = "Independent checksum bytes\n";
const sha = createHash("sha256").update(input).digest("hex");
const valid = `SHA256 (input) = ${sha}\n`;

test("cksum verifies issue manifests with every reporting option", async () => {
  const fs = await fixture({ input, valid, mixed: `INVALID\n${valid}`, missing: valid.replace("input", "gone") + valid });
  for (const args of [["-c"], ["--check"], ["--algorithm=sha256", "--check"], ["--strict", "--check"]]) {
    assert.deepEqual(await run("cksum", [...args, "valid"], { fs }), { exitCode: 0, stdout: "input: OK\n", stderr: "" });
  }
  for (const flag of ["--quiet", "--status"]) assert.deepEqual(await run("cksum", [flag, "-c", "valid"], { fs }), { exitCode: 0, stdout: "", stderr: "" });
  assert.equal((await run("cksum", ["--warn", "-c", "mixed"], { fs })).exitCode, 0);
  assert.ok((await run("cksum", ["--warn", "-c", "mixed"], { fs })).stderr.includes("mixed: 1:"));
  assert.equal((await run("cksum", ["--strict", "-c", "mixed"], { fs })).exitCode, 1);
  assert.deepEqual(await run("cksum", ["--ignore-missing", "-c", "missing"], { fs }), { exitCode: 0, stdout: "input: OK\n", stderr: "" });
});

test("cksum autodetects mixed tagged algorithms through Shell and verifies selected untagged hashes", async () => {
  const fs = await fixture({ input });
  const shell = new Shell({ fs, commands: registry, cwd: "/work" });
  try {
    assert.equal((await shell.exec("cksum -a sha256 input > manifest; cksum -a md5 input >> manifest; cksum -c manifest")).stdout, "input: OK\ninput: OK\n");
    assert.equal((await shell.exec("cksum -a sha256 --untagged input > plain; cksum -a sha256 -c plain")).exitCode, 0);
    assert.equal((await shell.exec("cksum -c plain")).exitCode, 1);
    await fs.writeFile("/work/input", new TextEncoder().encode("changed"));
    assert.equal((await shell.exec("cksum --status -c manifest")).exitCode, 1);
  } finally { await shell.dispose(); }
});

test("cksum rejects incompatible verification options before acquiring input", async () => {
  const fs = await fixture();
  fs.readStream = () => { assert.fail("invalid options acquired input"); };
  for (const args of [["--quiet"], ["--strict"], ["--ignore-missing"], ["-cz"], ["-cb"], ["-c", "--tag"], ["-c", "--raw"], ["-c", "--base64"]]) {
    assert.equal((await run("cksum", args, { fs })).exitCode, 2);
  }
});
