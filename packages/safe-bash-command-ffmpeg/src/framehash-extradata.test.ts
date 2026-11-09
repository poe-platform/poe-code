import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function checksum(input: string, options: string[], target = "-"): Promise<string> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/alac.m4a", readFileSync(new URL("./fixtures/extradata-alac.m4a", import.meta.url)));
  volume.writeFileSync("/pcm.wav", encodeWav({ sampleRate: 48000, channels: [new Float64Array(32)] }));
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", input, ...options, target],
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
  return target === "-" ? stdout : volume.readFileSync(target, "utf8").toString();
}

function withoutSoftware(output: string): string {
  return output.split("\n").filter(line => !line.startsWith("#software:")).join("\n");
}

for (const format of ["framemd5", "framehash"]) {
  for (const algorithm of ["md5", "sha512"]) {
    for (const target of ["-", "/frames.txt"]) {
      it(`matches native ALAC ${format} ${algorithm} headers and packets to ${target}`, async () => {
        const output = await checksum("/alac.m4a", ["-c:a", "copy", "-f", format,
          ...(format === "framemd5" && algorithm === "md5" ? [] : ["-hash", algorithm])], target);
        // FFmpeg 7.0.2: -i alac.m4a -c:a copy -f framemd5 - (or framehash -hash sha512).
        const expected = readFileSync(new URL(`./fixtures/extradata-alac-${algorithm}.txt`, import.meta.url), "utf8");
        assert.equal(withoutSoftware(output), withoutSoftware(expected));
      });
    }
  }

  it(`${format} numbers extradata by mapped output stream and places it before stream headers`, async () => {
    const output = await checksum("/pcm.wav", ["-i", "/alac.m4a", "-map", "0:a", "-map", "1:a", "-map", "1:a",
      "-c:a", "copy", "-f", format, "-hash", "md5"]);
    assert.deepEqual(output.split("\n").slice(3, 5), [
      "#extradata 1,                              36, 6ad6f3d1f435d03181653f003f87270e",
      "#extradata 2,                              36, 6ad6f3d1f435d03181653f003f87270e"
    ]);
    assert.ok(output.indexOf("#extradata 2,") < output.indexOf("#tb 0:"));
  });

  for (const codec of ["copy", "pcm_s16le"]) {
    it(`${format} omits extradata for PCM ${codec}`, async () => {
      const output = await checksum("/pcm.wav", ["-c:a", codec, "-f", format]);
      assert.ok(!output.includes("#extradata"), output);
    });
  }
}

it("uses CRC32 for extradata in version 1 framehash output", async () => {
  const output = await checksum("/alac.m4a", ["-c:a", "copy", "-f", "framehash", "-hash", "crc32", "-format_version", "1"]);
  assert.ok(output.startsWith("#format: frame checksums\n#version: 1\n#hash: CRC32\n#extradata 0,                              36, b4d3803a\n"), output);
});

it("omits the source ALAC extradata when decoding to PCM", async () => {
  const output = await checksum("/alac.m4a", ["-c:a", "pcm_s16le", "-f", "framemd5"]);
  assert.ok(output.includes("#codec_id 0: pcm_s16le\n"), output);
  assert.ok(!output.includes("#extradata"), output);
});
