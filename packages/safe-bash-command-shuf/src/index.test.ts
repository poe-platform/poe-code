import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBytePipe, createCommandArguments } from "safe-bash-contracts";
import { createShufCommand, createShufCommands, shufCommands } from "./index.js";

test("shuf permutes -e and -i ranges", async () => {
  assert.equal(createShufCommands().length, 1);
  assert.equal(shufCommands().name, "shuf-commands");
  const cmd = createShufCommand();
  const out = createBytePipe();
  const res = await cmd.execute({
    command: "shuf",
    args: createCommandArguments(["-i", "1-5", "-n", "3"]).args,
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: out.writable,
    stderr: createBytePipe().writable,
    signal: new AbortController().signal,
  });
  await out.close();
  assert.equal(res.exitCode, 0);
  const chunks: Uint8Array[] = [];
  for await (const c of out.readable) chunks.push(c);
  const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n");
  assert.equal(lines.length, 3);
});

test("shuf declares stdin, file input, and mutating named output support", () => {
  const requirements = createShufCommand().filesystemRequirements;
  assert.deepEqual(requirements?.map(mode => mode.id), ['stdin', 'file', 'output']);
  assert.equal(requirements?.find(mode => mode.id === 'output')?.mutates, true);
});

test("range sampling preserves a displaced value below the GNU sparse threshold", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/random", new Uint8Array([0, 0, 1, 0, 0]));
  const chunks: Uint8Array[] = [];
  const result = await createShufCommand().execute({
    command: "shuf",
    args: createCommandArguments(["--random-source=/random", "-i0-131070", "-n2"]).args,
    cwd: "/", env: {}, fs, stdin: createBytePipe().readable,
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), "1\n0\n");
});

test("shuf owns retained output chunks across flushes", async () => {
  const chunks: Uint8Array[] = [];
  const result = await createShufCommand().execute({
    command: "shuf", args: ["-i", "1-10000"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable, stdout: { async write(bytes) { chunks.push(bytes); } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } }, signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  const values = Buffer.concat(chunks).toString().trim().split("\n").map(Number).sort((a, b) => a - b);
  assert.deepEqual(values, Array.from({ length: 10000 }, (_, i) => i + 1));
});

test("shuf yields to queued cancellation before any output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel before output");
  const chunks: Uint8Array[] = [];
  const pending = setImmediate(() => controller.abort(reason));
  try {
    await assert.rejects(async () => createShufCommand().execute({
      command: "shuf", args: ["-i", "1-10"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
      stdin: createBytePipe().readable, stdout: { async write(bytes) { chunks.push(bytes); } },
      stderr: { async write() { assert.fail("unexpected diagnostic"); } }, signal: controller.signal,
    }), error => error === reason);
    assert.equal(chunks.length, 0);
  } finally { clearImmediate(pending); }
});
