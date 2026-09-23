import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBytes, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createBody } from "../../../src/commands/network/body.js";
import { parseArguments } from "../../../src/commands/network/args.js";
import { defaultNetworkLimits } from "../../../src/commands/network/types.js";

const payload = Buffer.from([0xf9, 0, 10, 0xf8]);

for (const flag of ["-F", "--form", "--form-string"]) {
  for (const attached of [false, true]) {
    for (const value of ["changed", "", "@input.dat", "<input.dat"]) {
      test(`curl ${flag} accepts nameless '${value}' (${attached ? "attached" : "separate"})`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir("/work");
        await fs.writeFile("/work/input.dat", payload);
        const args = attached ? [`${flag}${flag.startsWith("--") ? "=" : ""}=${value}`] : [flag, `=${value}`];
        args.push("http://127.0.0.1/upload");
        const signal = new AbortController().signal;
        const context: CommandContext = {
          command: "curl", args, fs, cwd: "/work", env: {}, signal,
          stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
        };
        const request = createBody(context, parseArguments(args, defaultNetworkLimits), defaultNetworkLimits)!;
        assert.ok(request.contentType?.startsWith("multipart/form-data; boundary="));
        const body = Buffer.from(await collectBytes(request.open(signal), { maxBytes: 4096 }));
        const headerEnd = body.indexOf("\r\n\r\n");
        const headers = body.subarray(body.indexOf("\r\n") + 2, headerEnd).toString();
        const file = flag !== "--form-string" && (value.startsWith("@") || value.startsWith("<"));
        const upload = file && value.startsWith("@");
        assert.equal(headers, upload
          ? 'Content-Disposition: form-data; filename="input.dat"\r\nContent-Type: application/octet-stream'
          : "Content-Disposition: form-data");
        assert.deepEqual(body.subarray(headerEnd + 4, body.lastIndexOf("\r\n--")), file ? payload : Buffer.from(value));
        assert.deepEqual(Buffer.from(await fs.readFile("/work/input.dat")), payload);
      });
    }
  }
}

test("curl still rejects form operands without an equals delimiter", () => {
  const args = ["-F", "missing", "http://127.0.0.1/upload"];
  assert.throws(() => createBody({} as CommandContext, parseArguments(args, defaultNetworkLimits), defaultNetworkLimits),
    { message: "Multipart form requires name=value", exitCode: 2 });
});
