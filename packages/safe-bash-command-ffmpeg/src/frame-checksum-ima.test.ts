import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";
import references from "./fixtures/frame-checksum-ima.json" with { type: "json" };

// FFmpeg 7.0.2 references for the 16-sample stereo PCM16 input below.
for (const [format, hash, digest] of [
  ["framehash", "SHA256", "9ba80b015855616455777344d729b65631ed8f87a589da1ec58996031970c4b2"],
  ["framemd5", "MD5", "75f9fa674d5bdd606bb93a62616712f0"],
  ["framecrc", "", "0x70d312fe"]
]) {
  for (const target of ["pipe:1", "/out.txt"]) {
    it(`${format} writes an IMA WAV encoder packet to ${target}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 16 }, (_, i) => (i * 751 - 6000) / 32768),
        Float64Array.from({ length: 16 }, (_, i) => (8311 - 632 * i) / 32768)
      ] });
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-c:a", "adpcm_ima_wav", "-f", format!, target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const expected = [
        ...(format === "framecrc" ? [] : ["#format: frame checksums", "#version: 2", `#hash: ${hash}`]),
        "#tb 0: 1/8000", "#media_type 0: audio", "#codec_id 0: adpcm_ima_wav",
        "#sample_rate 0: 8000", "#channel_layout_name 0: stereo",
        ...(format === "framecrc" ? [] : ["#stream#, dts,        pts, duration,     size, hash"]),
        `0,          0,          0,       16,     1024, ${digest}`, ""
      ].join("\n");
      assert.equal(target === "pipe:1" ? stdout : fs.readFileSync(target, "utf8"), expected);
      if (target !== "pipe:1") assert.equal(stdout, "");
    });
  }
}

for (const { channels, count, options, stdout: expected } of references) {
  it(`matches native IMA packet records: ${channels} channels, ${count} samples, ${options.join(" ") || "defaults"}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, channel) =>
      Float64Array.from({ length: count }, (_, i) => ((i * channels + channel) * 331 % 60001 - 30000) / 32768)) });
    const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    let stdout = "", stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-c:a", "adpcm_ima_wav", ...options, "-f", "framecrc", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
  });
}
