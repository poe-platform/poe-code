import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBytes, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createBody } from "../../../src/commands/network/body.js";
import { parseArguments } from "../../../src/commands/network/args.js";
import { defaultNetworkLimits } from "../../../src/commands/network/types.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

async function body(field: string, flag = "-F", headerFile = "X-Owned: file\nX-Other: second\n", maxBufferBytes = 4096) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const payload = Buffer.from([249, 0, 10, 248]);
  await fs.writeFile("/work/input", payload);
  await fs.writeFile("/work/headers", Buffer.from(headerFile));
  const args = [flag, field, "http://127.0.0.1/upload"];
  const signal = new AbortController().signal;
  const context: CommandContext = {
    command: "curl", args, cwd: "/work", env: {}, fs, signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  };
  const limits = { ...defaultNetworkLimits, maxBufferBytes };
  const request = createBody(context, parseArguments(args, limits), limits)!;
  return Buffer.from(await collectBytes(request.open(signal), { maxBytes: 8192 }));
}

for (const flag of ["-F", "--form"]) {
  for (const value of ["@input", "<input", "literal"]) {
    test(`multipart ${flag} ${value} inline and file headers`, async () => {
      const output = await body(`changed=${value};headers="X-Owned: inline";headers=@headers`, flag);
      assert.ok(output.includes("X-Owned: inline\r\nX-Owned: file\r\nX-Other: second\r\n\r\n"));
      assert.ok(output.includes(value === "literal" ? Buffer.from("literal") : Buffer.from([249, 0, 10, 248])));
    });
  }
}
test("form-string retains literal headers attributes", async () => {
  assert.ok((await body('changed=literal;headers=@headers', "--form-string")).includes("literal;headers=@headers"));
});
test("header files support comments and folded lines", async () => {
  assert.ok((await body("changed=@input;headers=@headers", "-F", "# comment\nX-Owned: first\n second\n\n")).includes("X-Owned: first second\r\n"));
});
test("custom part headers override generated MIME headers", async () => {
  const output = await body('changed=@input;headers="Content-Type: text/custom"');
  assert.ok(output.includes("Content-Type: text/custom\r\n"));
  assert.ok(!output.includes("Content-Type: application/octet-stream"));
});
test("inline part headers reject line injection", async () => {
  await assert.rejects(body('changed=@input;headers="X-Owned: value\r\nInjected: bad"'), { exitCode: 2 });
});
test("header file reads are bounded and missing files fail", async () => {
  await assert.rejects(body("changed=@input;headers=@headers", "-F", "X-Owned: " + "a".repeat(100), 32));
  await assert.rejects(body("changed=@input;headers=@missing"), { exitCode: 26 });
});
