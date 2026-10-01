import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { CommandRegistry, commandRuntimeIdentity, createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createSha512sumCommand, createSha512sumCommands, sha512Hex } from "./index.js";

test("sha512sum factories retain the shared command runtime identity", () => {
  for (const options of [{}, { limits: { maxInputBytes: 16, maxArgumentBytes: 32 } }]) {
    for (const definition of [createSha512sumCommand(options), ...createSha512sumCommands(options)]) {
      assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
      assert.equal(new CommandRegistry([definition]).has("sha512sum"), true);
      assert.throws(() => new CommandRegistry([{ ...definition, runtimeIdentity: {} }]));
    }
  }
});

test("sha512Hex matches node:crypto sha512 across empty, short, and multi-block inputs", () => {
  for (const input of ["", "abc", "hello world\n", "a".repeat(250), "x".repeat(1024)]) {
    const bytes = new TextEncoder().encode(input);
    const expected = createHash("sha512").update(bytes).digest("hex");
    assert.equal(sha512Hex(bytes), expected);
  }
});

for (const [filename, expected] of [
  ["/data.txt", "/data.txt: OK\n"],
  ["/weird\nname.txt", "\\/weird\\nname.txt: OK\n"],
  ["/weird\rname.txt", "\\/weird\\rname.txt: OK\n"],
  ["/weird\\name\n.txt", "\\/weird\\\\name\\n.txt: OK\n"],
] as const) {
  test(`sha512sum computes and verifies escaped manifests: ${JSON.stringify(filename)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile(filename, new TextEncoder().encode("test payload\n"));
    const cmd = createSha512sumCommand();

    const out1 = createBytePipe();
    const res1 = await cmd.execute({
      command: "sha512sum",
      args: createCommandArguments([filename]).args,
      cwd: "/",
      env: {},
      fs,
      stdin: createBytePipe().readable,
      stdout: out1.writable,
      stderr: createBytePipe().writable,
      signal: new AbortController().signal,
    });
    await out1.close();
    assert.equal(res1.exitCode, 0);
    const chunks: Uint8Array[] = [];
    for await (const c of out1.readable) chunks.push(c);
    const manifest = Buffer.concat(chunks).toString("utf8");
    await fs.writeFile("/sums.txt", new TextEncoder().encode(manifest));

    const out2 = createBytePipe();
    const res2 = await cmd.execute({
      command: "sha512sum",
      args: createCommandArguments(["-c", "/sums.txt"]).args,
      cwd: "/",
      env: {},
      fs,
      stdin: createBytePipe().readable,
      stdout: out2.writable,
      stderr: createBytePipe().writable,
      signal: new AbortController().signal,
    });
    await out2.close();
    assert.equal(res2.exitCode, 0);
    const status: Uint8Array[] = [];
    for await (const chunk of out2.readable) status.push(chunk);
    assert.equal(Buffer.concat(status).toString("utf8"), expected);
  });
}
