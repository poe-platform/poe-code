import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function checksum(input: string, options: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync(`/input.${input.split(".").at(-1)}`, readFileSync(new URL(`./fixtures/${input}`, import.meta.url)));
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", `/input.${input.split(".").at(-1)}`, ...options, "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return stdout.split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
}

it("keeps native WAV packet timestamps, sizes, and checksums after volume filtering", async () => {
  // FFmpeg 7.0.2: -i framecrc-tone.wav -af volume=0.5 -f framecrc -
  assert.deepEqual(await checksum("framecrc-tone.wav", ["-af", "volume=0.5", "-f", "framecrc"]), [
    ["0", "0", "0", "512", "1024", "0x4a21ebdf"],
    ["0", "512", "512", "512", "1024", "0x81c2ebe7"],
    ["0", "1024", "1024", "512", "1024", "0x9975ebf0"],
    ["0", "1536", "1536", "512", "1024", "0x8d3aebf9"],
    ["0", "2048", "2048", "512", "1024", "0x5d0fec01"],
    ["0", "2560", "2560", "512", "1024", "0x0cf4ec09"],
    ["0", "3072", "3072", "128", "256", "0x5e25bc60"]
  ]);
});

for (const input of ["framecrc-tone.wav", "adts-copy-0.aac"]) {
  for (const format of ["framecrc", "framemd5", "framehash"]) {
    it(`retains decoded ${input} packets through identity filtering in ${format}`, async () => {
      const unfiltered = await checksum(input, ["-f", format]);
      assert.ok(unfiltered.length > 1);
      assert.deepEqual(await checksum(input, ["-af", "volume=1", "-f", format]), unfiltered);
    });
  }
}

it("keeps selected packet payloads and shifted timestamps", async () => {
  const original = await checksum("framecrc-tone.wav", ["-f", "framecrc"]);
  const selected = await checksum("framecrc-tone.wav", ["-af", "aselect=mod(n\\,2),asetpts=PTS-1024", "-f", "framecrc"]);
  assert.deepEqual(selected, original.filter((_, index) => index % 2 === 1).map(row =>
    [row[0], String(Number(row[1]) - 1024), String(Number(row[2]) - 1024), ...row.slice(3)]));
});

it("uses filter-produced packet sizes and retains the short final packet", async () => {
  const rows = await checksum("framecrc-tone.wav", ["-af", "asetnsamples=n=1000:p=0,volume=0.5", "-f", "framecrc"]);
  assert.deepEqual(rows.map(row => row.slice(1, 5)), [
    ["0", "0", "1000", "2000"], ["1000", "1000", "1000", "2000"],
    ["2000", "2000", "1000", "2000"], ["3000", "3000", "200", "400"]
  ]);
});

it("retains packet boundaries when limiting the number of audio frames", async () => {
  const original = await checksum("framecrc-tone.wav", ["-f", "framecrc"]);
  assert.deepEqual(await checksum("framecrc-tone.wav", ["-frames:a", "2", "-f", "framecrc"]), original.slice(0, 2));
});

it("checksums the filtered AAC PCM payload separately in each packet", async () => {
  const original = await checksum("adts-copy-0.aac", ["-f", "framecrc"]);
  assert.deepEqual(await checksum("adts-copy-0.aac", ["-af", "volume=0", "-f", "framecrc"]),
    original.map(row => [...row.slice(0, 5), "0x00000000"]));
});

it("retains resampled packet boundaries and the final resampler flush", async () => {
  const rows = await checksum("framecrc-tone.wav", ["-af", "volume=0.5", "-ar", "12000", "-f", "framecrc"]);
  // Native FFmpeg 7.0.2 holds 16 input samples until the next frame or EOF.
  assert.deepEqual(rows.map(row => row.slice(1, 5)), [
    ["0", "0", "744", "1488"], ["744", "744", "768", "1536"],
    ["1512", "1512", "768", "1536"], ["2280", "2280", "768", "1536"],
    ["3048", "3048", "768", "1536"], ["3816", "3816", "768", "1536"],
    ["4584", "4584", "192", "384"], ["4776", "4776", "24", "48"]
  ]);
});
