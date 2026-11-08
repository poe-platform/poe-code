import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource } from "safe-bash-contracts";
import { createCmpCommand } from "./index.js";

test("cmp enforces host input admission before processing bytes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new TextEncoder().encode("123\n"));
  await fs.writeFile("/b", new TextEncoder().encode("123\n"));
  const failure = new Error("host input limit");
  await assert.rejects(async () => createCmpCommand().execute({
    command: "cmp", args: ["/a","/b"], fs, cwd: "/", env: {},
    stdin: toByteSource("123\n"), signal: new AbortController().signal,
    inputBudget: { maxBytes: 3, check(bytes) { if (bytes > 3) throw failure; } },
    stdout: { async write() { assert.fail("over-budget input emitted output"); } },
    stderr: { async write() {} },
  }), error => error === failure);
});
