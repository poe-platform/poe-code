import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function framecrc(fixture: string, flags: string[] = []) {
  const volume = Volume.fromJSON({
    [`/${fixture}`]: readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url))
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...flags, "-i", `/${fixture}`, "-c:a", "copy", "-f", "framecrc", "/out.txt"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out.txt", "utf8").toString();
}

it("preserves AAC priming timestamps, discard flags, and skip-sample side data", async () => {
  const output = await framecrc("frame-checksum-tone.m4a");
  // Native FFmpeg 7.0.2: -i tone.m4a -c:a copy -f framecrc out.txt.
  assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#")), [
    "0,      -1024,      -1024,     1024,      551, 0x9060ee8e, F=0x5, S=1,       10",
    "0,          0,          0,     1024,      531, 0x96d12222",
    "0,       1024,       1024,     1024,      529, 0xa2c60e43",
    "0,       2048,       2048,     1024,      539, 0xe0b9e71b",
    "0,       3072,       3072,      128,        5, 0x03c001be"
  ]);
});

for (const flags of [[], ["-copyts"], ["-copyts", "-start_at_zero"]]) {
  it(`preserves MP3 priming and padding in framecrc (${flags.join(" ") || "default"})`, async () => {
    const output = await framecrc("frame-checksum-tone.mp3", flags);
    assert.ok(output.includes("#tb 0: 1/14112000\n"));
    assert.ok(output.includes("#sample_rate 0: 8000\n"));
    const rows = (text: string) => text.split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()));
    const expected = rows(readFileSync(new URL("./fixtures/frame-checksum-tone.txt", import.meta.url), "utf8"));
    if (flags.length === 1) {
      for (const row of expected) {
        row[1] = String(Number(row[1]) + 1949220);
        row[2] = String(Number(row[2]) + 1949220);
      }
    }
    assert.deepEqual(rows(output), expected);
  });
}

it("rounds the MP3 input origin through FFmpeg's microsecond time base", async () => {
  const output = await framecrc("copy-mono.mp3");
  assert.ok(output.includes("#sample_rate 0: 44100\n"));
  assert.equal(output.split("\n").find(line => line.startsWith("0,")),
    "0,    -353604,    -353604,   368640,      626, 0x8f82f48e, S=1,       10");
});
