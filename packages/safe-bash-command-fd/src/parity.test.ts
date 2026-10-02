import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createFdCommand, evalSyncFd, type SyncFdVfsNode } from "./index.js";

const names = ["a.c", "b.h", "c.txt", "nested.js", "nested.ts"];
const directory: SyncFdVfsNode = { type: "directory", size: 0,
  children: names.map(name => ({ name, type: "file", size: 0 })) };

for (const args of [["-g", "*.[ch]"], ["-g", "*.{c,h}"], [".", "-E", "*.{js,ts}"], [".", "-E", "*.[ch]"], ["-g", "*["], ["-g", "*.{c,h"]]) {
  test(`fd delegates complex globs to the shared matcher: ${args.join(" ")}`, () => {
    assert.equal(evalSyncFd(args, "/work", path => path === "/work" ? directory : undefined), undefined);
  });
}

for (const [args, expected] of [
  [["-g", "*.[ch]"], "a.c\nb.h\n"],
  [["-g", "*.{c,h}"], "a.c\nb.h\n"],
  [[".", "-E", "*.{js,ts}"], "a.c\nb.h\nc.txt\n"],
  [[".", "-E", "*.[ch]"], "c.txt\nnested.js\nnested.ts\n"],
  [["--search-path", "/work", "nested"], "/work/nested.js\n/work/nested.ts\n"],
] as const) {
  test(`fd search parity: ${args.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    for (const name of names) await fs.writeFile(`/work/${name}`, new Uint8Array());
    let stdout = "", stderr = "";
    const result = await createFdCommand().execute({ command: "fd", args, cwd: "/work", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout, expected);
    assert.equal(stderr, "");
  });
}

for (const root of ["/does-not-exist", "/file"]) {
  test(`fd rejects a non-directory search root: ${root}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array());
    let stdout = "", stderr = "";
    const result = await createFdCommand().execute({ command: "fd", args: ["foo", root], cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(stdout, "");
    assert.ok(stderr.includes(root), stderr);
  });
}
