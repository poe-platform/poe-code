import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts";
import { createOpensslCommand } from "./index.js";
import { Io } from "./io.js";

test("input owns producer fragments before advancing a reused buffer", async () => {
  const buffer = new Uint8Array([1, 2]);
  const context = {
    fs: createMemoryFileSystem(), cwd: "/", signal: new AbortController().signal,
    stdin: (async function* () { yield buffer; buffer.set([3, 4]); yield buffer; buffer.fill(0); })(),
  } as unknown as CommandContext;
  assert.deepEqual(await new Io(context, 4).read(), new Uint8Array([1, 2, 3, 4]));
});

test("resource and option errors fail before writing output files", async () => {
  for (const args of [
    ["rand", "-out", "/result", "1000000000"],
    ["rand", "-out", "/result", "12garbage"],
    ["enc", "-aes-256-cbc", "-k", "pw", "-pbkdf2", "-iter", "1000000000", "-out", "/result"],
    ["genrsa", "-out", "/result", "1000000"],
    ["dgst", "-unknown", "-out", "/result"],
    ["pkey", "-in", "/bad", "-check", "-noout"],
    ["x509", "-in", "/bad", "-noout", "-subject"],
  ]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/bad", new TextEncoder().encode("garbage"));
    const output: Uint8Array[] = [];
    const context = { args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } }, stderr: { async write() {} },
    } as unknown as CommandContext;
    assert.equal((await createOpensslCommand().execute(context)).exitCode, 1, args.join(" "));
    assert.equal(output.length, 0);
    await assert.rejects(fs.readFile("/result"), { code: "ENOENT" });
  }
});

test("cancellation stops source collection and prevents output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled by caller");
  const context = {
    args: ["sha256"], cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: controller.signal,
    stdin: (async function* () { yield new Uint8Array([1]); controller.abort(reason); yield new Uint8Array([2]); })(),
    stdout: { async write() { assert.fail("no output after cancellation"); } }, stderr: { async write() { assert.fail("preserve abort reason"); } },
  } as unknown as CommandContext;
  await assert.rejects(async () => createOpensslCommand().execute(context), (error: unknown) => error === reason);
});
