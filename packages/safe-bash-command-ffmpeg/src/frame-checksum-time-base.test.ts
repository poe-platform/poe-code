import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const videoInput = ["-f", "rawvideo", "-video_size", "2x2", "-pixel_format", "gray", "-framerate", "4"];
const audioInput = ["-f", "s16le", "-ac", "1", "-ar", "8000"];

async function checksum(input: string[], output: string[]): Promise<string> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/i.raw", Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...input, "-i", "/i.raw", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return stdout;
}

function rows(output: string): string[][] {
  return output.trim().split("\n").filter(line => !line.startsWith("#")).map(line => line.split(",").map(field => field.trim()));
}

// Native FFmpeg 7.0.2, using the eight bytes 00..07 as gray 2x2 video or mono s16le.
for (const [format, videoHashes, audioHash] of [
  ["framemd5", ["37b59afd592725f9305e484a5d7f5168", "a6b8537b97d58b417d3dfdd1030b15d2"], "3677509751ccf61539174d2b9635a7bf"],
  ["framehash", ["054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8", "c6d44cf418f610e3fe9e1d9294ff43def81c6cdcad6cbb1820cff48d3aa4355d"], "8a851ff82ee7048ad09ec3847f1ddf44944104d2cbd17ef4e3db22c6785a0d45"],
  ["framecrc", ["0x000a0006", "0x00320016"], "0x0054001c"]
] as const) {
  for (const [base, header, duration] of [
    ["1:1000", "1/1000", 250], ["1:8", "1/8", 2], ["2/16", "1/8", 2],
    ["0.125", "1/8", 2], ["0", "1/4", 1]
  ] as const) {
    for (const option of ["-enc_time_base", "-enc_time_base:v"]) {
      it(`${format} rescales video header and packets for ${option} ${base}`, async () => {
        const output = await checksum(videoInput, [option, base, "-fflags", "+bitexact", "-f", format, "-"]);
        assert.ok(output.includes(`#tb 0: ${header}\n`), output);
        assert.deepEqual(rows(output), videoHashes.map((hash, index) =>
          ["0", String(index * duration), String(index * duration), String(duration), "4", hash]));
      });
    }
  }
  for (const option of ["-enc_time_base", "-enc_time_base:a", "-enc_time_base:a:0", "-enc_time_base:0"]) {
    it(`${format} rescales audio timing without truncating the hashed samples for ${option}`, async () => {
      const output = await checksum(audioInput, [option, "1:1000", "-fflags", "+bitexact", "-f", format, "-"]);
      assert.ok(output.includes("#tb 0: 1/1000\n"), output);
      assert.deepEqual(rows(output), [["0", "0", "0", "1", "8", audioHash]]);
    });
  }
  it(`${format} preserves the input time base when copying packets`, async () => {
    const output = await checksum(videoInput, ["-c:v", "copy", "-enc_time_base", "1:1000", "-fflags", "+bitexact", "-f", format, "-"]);
    assert.ok(output.includes("#tb 0: 1/4\n"), output);
    assert.deepEqual(rows(output), videoHashes.map((hash, index) => ["0", String(index), String(index), "1", "4", hash]));
  });
}

it("keeps video-only encoder time bases off audio streams", async () => {
  const output = await checksum(audioInput, ["-enc_time_base:v", "1:1000", "-f", "framemd5", "-"]);
  assert.ok(output.includes("#tb 0: 1/8000\n"), output);
  assert.equal(rows(output)[0]![3], "4");
});

it("resets encoder time bases for the next output", async () => {
  const output = await checksum(videoInput, ["-enc_time_base", "1:1000", "-f", "framemd5", "/first.txt", "-f", "framemd5", "-"]);
  assert.ok(output.includes("#tb 0: 1/4\n"), output);
  assert.deepEqual(rows(output).map(row => row.slice(1, 4)), [["0", "0", "1"], ["1", "1", "1"]]);
});

it("applies the last matching option to each mapped output stream", async () => {
  const output = await checksum(videoInput, ["-map", "0:v", "-map", "0:v", "-enc_time_base", "1:1000",
    "-enc_time_base:v:1", "1:8", "-f", "framemd5", "-"]);
  assert.ok(output.includes("#tb 0: 1/1000\n"), output);
  assert.ok(output.includes("#tb 1: 1/8\n"), output);
  assert.deepEqual(rows(output).map(row => row.slice(0, 4)), [
    ["0", "0", "0", "250"], ["1", "0", "0", "2"],
    ["0", "250", "250", "250"], ["1", "2", "2", "2"]
  ]);
});
