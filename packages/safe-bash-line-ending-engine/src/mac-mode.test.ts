import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLineEndingExecutor } from "./command.js";
import type { Direction } from "./internal.js";

async function run(command: Direction, args: string[], input: string | Uint8Array = "", chunkSize = 1, fs = new MemoryFileSystem()) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createLineEndingExecutor(command, { limits: { chunkSize } })({
    command, args, fs, cwd: "/", env: { LC_ALL: "C.UTF-8" }, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {
      const bytes = typeof input === "string" ? Buffer.from(input) : input;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, offset + chunkSize);
    } },
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

// Expected byte sequences checked against native dos2unix/unix2dos 7.5.1.
for (const command of ["dos2unix", "unix2dos"] as const) {
  const dos = command === "dos2unix";
  for (const chunkSize of [1, 2, 16]) {
    for (const option of ["-c", "--convmode"]) {
      test(`${command} ${option} mac preserves CRLF across ${chunkSize}-byte chunks`, async () => {
        assert.deepEqual(await run(command, [option, "mac"], "a\rb\r\nc\nd\r\ré", chunkSize), {
          exitCode: 0, stderr: "", stdout: dos ? "a\nb\r\nc\nd\n\né" : "a\rb\r\nc\rd\r\ré",
        });
      });
    }
  }
  test(`${command} Mac mode doubles only converted line endings`, async () => {
    assert.deepEqual(await run(command, ["-c", "mac", "-l"], "a\rb\r\nc\nd\r"), {
      exitCode: 0, stderr: "", stdout: dos ? "a\n\nb\r\nc\nd\n\n" : "a\rb\r\nc\r\rd\r",
    });
  });
  for (const ending of ["", "\r", "\n", "\r\n"]) {
    test(`${command} Mac mode adds a final line ending only when missing: ${JSON.stringify(ending)}`, async () => {
      assert.deepEqual(await run(command, ["-c", "mac", "-e"], `a${ending}`), {
        exitCode: 0, stderr: "", stdout: ending === "\r\n" ? "a\r\n" : dos ? "a\n" : "a\r",
      });
    });
  }
  test(`${command} Mac mode counts mixed line endings`, async () => {
    const result = await run(command, ["-c", "mac", "-v"], "a\rb\r\nc\nd\r\re");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, `${command}: Converted ${dos ? 3 : 1} out of 5 line breaks.\n`);
  });
  test(`${command} Mac mode remains active after selecting the byte conversion mode`, async () => {
    const result = await run(command, ["-c", "MAC", "-c", "ascii"], "a\rb\n");
    assert.deepEqual(result, { exitCode: 0, stderr: "", stdout: dos ? "a\nb\n" : "a\rb\r" });
  });
  for (const endian of ["le", "be"]) {
    test(`${command} Mac mode converts UTF-16${endian.toUpperCase()} across byte chunks`, async () => {
      const input = Buffer.from(dos ? "\ufeffa\rb\r" : "\ufeffa\nb\n", "utf16le");
      if (endian === "be") input.swap16();
      assert.deepEqual(await run(command, ["-c", "mac", "-r"], input), {
        exitCode: 0, stderr: "", stdout: dos ? "a\nb\n" : "a\rb\r",
      });
    });
  }
  test(`${command} Mac mode leaves binary VFS input intact`, async () => {
    const fs = new MemoryFileSystem();
    const input = Buffer.from("a\rb\n\0");
    await fs.writeFile("/binary", input);
    assert.deepEqual(await run(command, ["-c", "mac", "-q", "binary"], "", 1, fs), {
      exitCode: 0, stdout: "", stderr: "",
    });
    assert.deepEqual(Buffer.from(await fs.readFile("/binary")), input);
  });
  for (const newFile of [false, true]) {
    test(`${command} Mac mode converts ${newFile ? "new" : "existing"} VFS files`, async () => {
      const fs = new MemoryFileSystem();
      const input = dos ? "a\rb\r" : "a\nb\n";
      await fs.writeFile("/input", Buffer.from(input));
      const result = await run(command, ["-c", "mac", ...(newFile ? ["-n", "input", "output"] : ["input"])], "", 1, fs);
      assert.deepEqual(result, {
        exitCode: 0, stdout: "",
        stderr: `${command}: converting file input to ${newFile ? "file output in " : ""}${dos ? "Unix" : "Mac"} format...\n`,
      });
      assert.equal(Buffer.from(await fs.readFile(newFile ? "/output" : "/input")).toString(), dos ? "a\nb\n" : "a\rb\r");
      if (newFile) assert.equal(Buffer.from(await fs.readFile("/input")).toString(), input);
    });
  }
  test(`${command} Mac mode selects files needing conversion in info mode`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/mac", Buffer.from("a\r"));
    await fs.writeFile("/dos", Buffer.from("a\r\n"));
    await fs.writeFile("/unix", Buffer.from("a\n"));
    assert.deepEqual(await run(command, ["-c", "mac", "-ic", "mac", "dos", "unix"], "", 1, fs), {
      exitCode: 0, stderr: "", stdout: dos ? "mac\n" : "unix\n",
    });
  });
}
