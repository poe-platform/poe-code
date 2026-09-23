import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, iconvCommands } from "../../../src/index.js";
import { run } from "./helpers.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

const input = new TextEncoder().encode("Changed café\n");
const expected = Uint8Array.from(Buffer.from("004300680061006e006700650064002000630061006600e9000a", "hex"));

for (const option of ["-o result", "-oresult", "--output=result", "--output result"]) {
  for (const operand of ["source", "", "-"]) test(`iconv ${option} converts ${operand || "stdin"} to a VFS file`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/source", input);
    await fs.writeFile("/work/result", new TextEncoder().encode("old longer content must be truncated"));
    const shell = new Shell({ fs, cwd: "/work" }).use(iconvCommands());
    try {
      const result = await shell.exec(`iconv -f UTF-8 -t UTF-16BE ${option} ${operand}`, { stdin: input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(await fs.readFile("/work/result"), expected);
      assert.deepEqual(await fs.readFile("/work/source"), input);
    } finally { await shell.dispose(); }
  });
}

test("iconv output '-' uses stdout and repeated options select the last destination", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv -f UTF-8 -t UTF-16BE -o unused --output=-", { stdin: input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, expected);
    assert.deepEqual(await fs.readdir("/"), []);
  } finally { await shell.dispose(); }
});

test("iconv concatenates converted inputs into one output file", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/source", input);
  const shell = new Shell({ fs }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv -f UTF-8 -t UTF-16BE -o result source source");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await fs.readFile("/result"), Uint8Array.from([...expected, ...expected]));
  } finally { await shell.dispose(); }
});

for (const option of ["-o", "--output"]) test(`iconv ${option} requires a destination`, async () => {
  const result = await run(["-f", "UTF-8", "-t", "UTF-16BE", option], input);
  assert.equal(result.exitCode, 64);
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /requires an argument/);
  assert.equal(result.stdoutHex, "");
});

test("iconv reports output filesystem errors without emitting converted stdout", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(iconvCommands());
  try {
    const result = await shell.exec("iconv -f UTF-8 -t UTF-16BE --output=missing/result", { stdin: input });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /iconv:.*output.*No such file or directory/);
    assert.equal(result.stdoutBytes.length, 0);
  } finally { await shell.dispose(); }
});

test("iconv file output enforces the conversion output budget", async () => {
  const fs = new MemoryFileSystem();
  const result = await run(["-f", "UTF-8", "-t", "UTF-16BE", "-o", "result"], input,
    { limits: { maxOutputBytes: expected.length - 1 } }, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdoutHex, "");
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /output bytes limit exceeded/);
  assert.deepEqual(await fs.readFile("/result"), new Uint8Array());
});

test("iconv cancellation drains its admitted filesystem writer", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const reason = new Error("stop conversion");
  let retired = false;
  fs.writeStream = async (_path, source) => {
    try {
      for await (const chunk of source) {
        assert.deepEqual(chunk, expected);
        controller.abort(reason);
      }
    } finally { retired = true; }
  };
  await assert.rejects(run(["-f", "UTF-8", "-t", "UTF-16BE", "-o", "result"], input, {},
    { fs, signal: controller.signal }), error => error === reason);
  assert.equal(retired, true);
});
