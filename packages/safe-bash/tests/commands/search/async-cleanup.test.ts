import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";

for (const [producer, failureStatus] of [["grep foo /nonexistent", 2], ["find /nonexistent -name '*.txt'", 1]] as const) {
  test(`${producer} still runs downstream stages and publishes PIPESTATUS`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
    try {
      const result = await shell.exec(`${producer} | wc -l; printf '%s\\n' "\${PIPESTATUS[@]}"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `0\n${failureStatus}\n0\n`);
      assert.ok(result.stderr.length > 0);
    } finally { await shell.dispose(); }
  });
  test(`${producer} respects pipefail and errexit`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
    try {
      const result = await shell.exec(`set -eo pipefail; ${producer} | wc -l; echo unreachable`);
      assert.equal(result.exitCode, failureStatus);
      assert.equal(result.stdout, "0\n");
    } finally { await shell.dispose(); }
  });
}

test("large grep output flows through every downstream stage without overflowing", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/large.txt", new TextEncoder().encode(("a".repeat(100) + "\n").repeat(800)));
  const shell = new Shell({ fs }).use(standardCommands());
  try {
    for (const pipeline of ["wc -l", "cut -d: -f1 | tr a b | sort | wc -l", "head -n 3 | wc -l"]) {
      const result = await shell.exec(`grep a /large.txt | ${pipeline}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, pipeline.startsWith("head") ? "3\n" : "800\n");
    }
  } finally { await shell.dispose(); }
});

test("rg inventory emits large initial output exactly once", async () => {
  const fs = createMemoryFileSystem();
  const names = Array.from({ length: 900 }, (_, i) => `/input-${String(i).padStart(4, "0")}-${"x".repeat(64)}`);
  for (const name of names) await fs.writeFile(name, new Uint8Array());
  const { createSearchCommands } = await import("../../../src/commands/search/index.js");
  const { toByteSource } = await import("../../../src/contracts/index.js");
  const chunks: Uint8Array[] = [];
  const result = await createSearchCommands()[0]!.execute({
    command: "rg", args: ["--files", "/"], cwd: "/", env: {}, fs,
    stdin: toByteSource(""), stdinIsDefault: true, signal: new AbortController().signal,
    ...{ _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true },
    stdout: { writeSync() { return false; }, async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).length, Buffer.byteLength(names.map(name => `${name}\n`).join("")));
  assert.equal(Buffer.concat(chunks).toString(), names.map(name => `${name}\n`).join(""));
});

for (const failure of [undefined, Object.assign(new Error("closed"), { code: "EPIPE" }), new Error("sink failed")]) {
  test(`rg owns deferred output cleanup: ${failure?.message ?? "success"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", new TextEncoder().encode("foo\n"));
    const { createSearchCommands } = await import("../../../src/commands/search/index.js");
    const { toByteSource } = await import("../../../src/contracts/index.js");
    const command = createSearchCommands()[0]!;
    let finish!: () => void;
    let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const deferred = new Promise<void>(resolve => { finish = resolve; });
    const context = {
      command: "rg", args: ["--files", "/"], cwd: "/", env: {}, fs,
      stdin: toByteSource(""), stdinIsDefault: true, signal: new AbortController().signal,
      _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
      stdout: { writeSync() { return false; }, async write(bytes: Uint8Array) {
        assert.equal(new TextDecoder().decode(bytes), "/input\n");
        started();
        await deferred;
        if (failure) throw failure;
      } },
      stderr: { async write() {} },
    };
    const pending = command.execute(context);
    const checked = Promise.resolve(pending).then(result =>
      assert.equal(result.exitCode, failure && !Object.hasOwn(failure, "code") ? 2 : 0));
    await writing;
    try {
      const other = await command.execute({ ...context, stdout: { writeSync() { return true; }, async write() {} } });
      assert.equal(other.exitCode, 0);
    } finally {
      finish();
    }
    await checked;
    const again = await command.execute({ ...context, stdout: { writeSync() { return true; }, async write() {} } });
    assert.equal(again.exitCode, 0);
  });
}
