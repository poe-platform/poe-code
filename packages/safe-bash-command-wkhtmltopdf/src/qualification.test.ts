import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts/io";
import { createWkhtmltopdfCommand, runWkhtmltopdf, wkhtmltopdfLimits } from "./command.js";

// Independent source-derived status controls, not native execution or layout proof.
test("command and SDK preserve error precedence and suppress failed-job publication", async () => {
  for (const [success, errorCode, expected] of [
    [true, 404, 2], [false, 404, 2], [true, 401, 3], [false, 401, 3],
    [true, 500, 1], [true, 1003, 1], [false, 0, 1],
  ] as const) {
    for (const route of ["command", "sdk"] as const) {
      const fs = new MemoryFileSystem();
      const original = new TextEncoder().encode("previous destination");
      await fs.writeFile("/out.pdf", original);
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      let closed = 0;
      let consumed = false;
      const context = {
        command: "wkhtmltopdf", args: ["-", "/out.pdf"], fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: toByteSource("<p>status control</p>"),
        stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } },
      };
      const options = {
        limits: wkhtmltopdfLimits,
        renderer: {
          profile: { id: "status-control-only", features: [] },
          async open() {
            return {
              success, errorCode, networkErrorName: "HostNotFoundError",
              chunks: { *[Symbol.iterator]() { consumed = true; yield Uint8Array.of(37); } },
              async close() { closed++; },
            };
          },
        },
      };
      const result = route === "sdk" ? await runWkhtmltopdf(context, options) :
        await createWkhtmltopdfCommand(options).execute(context);
      assert.equal(result.exitCode, expected, `${route}: ${success}/${errorCode}`);
      assert.equal(closed, 1);
      assert.equal(consumed, false);
      assert.deepEqual(stdout, []);
      assert.ok(stderr.length > 0);
      assert.deepEqual(await fs.readFile("/out.pdf"), original);
    }
  }
});

test("default conversion has no fallback authority even for hostile resource markup", async () => {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let read = false;
  const fs = new MemoryFileSystem();
  fs.openReadFile = async () => { read = true; throw new Error("forbidden acquisition"); };
  const result = await runWkhtmltopdf({
    args: ["/ambient.html", "-"], fs, cwd: "/", signal: new AbortController().signal,
    stdin: toByteSource("<script>fetch('https://denied.invalid')</script>"),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
  }, { limits: wkhtmltopdfLimits });
  assert.deepEqual(result, { kind: "rejected", exitCode: 1, code: "UNSUPPORTED_CAPABILITY" });
  assert.equal(read, false);
  assert.deepEqual(stdout, []);
  assert.ok(new TextDecoder().decode(stderr[0]).includes("UNSUPPORTED_CAPABILITY"));
});
