import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createOpCommands, createObjectBackend } from "./index.js";

test("standalone commands acquire template bytes from the supplied VFS", async () => {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const reads: string[] = [];
  const context = {
    args: ["inject", "-i", "template"], cwd: "/work", env: {},
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
    fs: { capabilities: { read: true }, async readFile(path: string) {
      reads.push(path);
      return new TextEncoder().encode("TOKEN={{ op://Team/Login/password }}");
    } },
  } as unknown as CommandContext;
  const backend = createObjectBackend({ vaults: [{ id: "team", name: "Team" }],
    items: [{ id: "login", title: "Login", vault: "team", fields: [{ id: "password", value: "synthetic-token" }] }] });
  const result = await createOpCommands({ backend })[0]!.execute(context);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.deepEqual(reads, ["/work/template"]);
  assert.equal(Buffer.concat(output).toString(), "TOKEN=synthetic-token");
});
