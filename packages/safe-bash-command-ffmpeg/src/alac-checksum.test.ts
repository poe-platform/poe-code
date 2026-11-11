import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from({ length: 16 }, (_, i) => (i * 751 - 6000) / 32768),
  Float64Array.from({ length: 16 }, (_, i) => (8311 - 632 * i) / 32768)
] });

async function checksum(format: string, codec: string, target: string, source = input, options: string[] = []): Promise<string> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", source);
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-c:a", codec, ...options, "-f", format, target],
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
  if (target === "pipe:1") return stdout;
  assert.equal(stdout, "");
  return volume.readFileSync(target, "utf8").toString();
}

// Native Linux FFmpeg 7.0.2, stereo PCM16 WAV with the sixteen samples above.
const digest = "a5eabf9af8c0b5b85b94ed4a3513d796524ed0687facabaab40d40061a48ddfe";
const headers = "#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: alac\n#sample_rate 0: 8000\n#channel_layout_name 0: stereo\n";
const hashHeader = "#format: frame checksums\n#version: 2\n#hash: SHA256\n";
const columns = "#stream#, dts,        pts, duration,     size, hash\n";
const row = "0,          0,          0,       16,       72, ";
const expected = {
  hash: `SHA256=${digest}\n`,
  streamhash: `0,a,SHA256=${digest}\n`,
  framehash: `${hashHeader}#extradata 0,                              36, 55b7b01bd193c0f8bf310dc1482b4abb60aeee3ff3b15849156d236349f16961\n${headers}${columns}${row}${digest}\n`,
  framecrc: `#extradata 0:       36, 0x441c03a5\n${headers}${row}0x00be1d0d\n`
};

for (const target of ["pipe:1", "/checksum.txt"]) {
  for (const [format, output] of Object.entries(expected)) {
    it(`hashes ALAC encoder packets and configuration with ${format} to ${target}`, async () => {
      assert.equal(await checksum(format, "alac", target), output);
    });
  }
  it(`retains the PCM framehash control to ${target}`, async () => {
    assert.equal(await checksum("framehash", "pcm_s16le", target),
      `${hashHeader}${headers.replace("alac", "pcm_s16le")}${columns}0,          0,          0,       16,       64, 5d6c4bd6b71e6cfaa724ec763e7368e6d703e5fdaa4152229bc8fd0c65b129ad\n`);
  });
}

// FFmpeg 7.0.2 uses verbatim packets for this deterministic noise fixture.
const noise = [new Float64Array(4097), new Float64Array(4097)];
let state = 1;
for (let frame = 0; frame < 4097; frame++) for (const channel of noise) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  channel[frame] = (state >> 16) / 32768;
}
const noiseInput = encodeWav({ sampleRate: 8000, channels: noise });

it("hashes full and partial ALAC packets without container headers", async () => {
  assert.equal(await checksum("hash", "alac", "pipe:1", noiseInput),
    "SHA256=caee675b9a3f194bc0d6c59932e3b7fc57e673b8176114b5b2d7a352d7abf283\n");
});

it("retains ALAC packet boundaries and timestamps after encoding", async () => {
  const output = await checksum("framehash", "alac", "pipe:1", noiseInput);
  assert.deepEqual(output.trim().split("\n").filter(line => !line.startsWith("#")), [
    "0,          0,          0,     4096,    16388, 6df77aa113bff1a5d4057ca67532ed029903b8cf16bc193f444e161456b951d3",
    "0,       4096,       4096,        1,       12, 0eb71e33bf364f507c0fe9665a5cb6d198a7969e35e4865ad279d7cc42a35f9a"
  ]);
});

it("hashes each mapped ALAC stream independently", async () => {
  assert.equal(await checksum("streamhash", "alac", "pipe:1", input, ["-map", "0:a", "-map", "0:a"]),
    `0,a,SHA256=${digest}\n1,a,SHA256=${digest}\n`);
});

it("keeps indexed PCM and ALAC encoders separate in frame checksums", async () => {
  const output = await checksum("framehash", "alac", "pipe:1", input,
    ["-map", "0:a", "-map", "0:a", "-c:a:0", "pcm_s16le"]);
  assert.ok(output.includes("#extradata 1,                              36, 55b7b01bd193c0f8bf310dc1482b4abb60aeee3ff3b15849156d236349f16961\n"));
  assert.ok(!output.includes("#extradata 0"));
  assert.deepEqual(output.trim().split("\n").filter(line => !line.startsWith("#")), [
    "0,          0,          0,       16,       64, 5d6c4bd6b71e6cfaa724ec763e7368e6d703e5fdaa4152229bc8fd0c65b129ad",
    `1,          0,          0,       16,       72, ${digest}`
  ]);
});
