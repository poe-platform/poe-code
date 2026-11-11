import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, codecs: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 16 }, (_, i) => (i * 751 - 6000) / 32768),
    Float64Array.from({ length: 16 }, (_, i) => (8311 - 632 * i) / 32768)
  ] }));
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-map", "0:a", "-map", "0:a", ...codecs, "-f", format, "pipe:1"],
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
  return { ...result, stdout, stderr };
}

const u8 = "12b2ef6de4d9c40dc242d7fe7052eed80a7e46096f4460fd4d05cca977b3c66b";
const s16be = "938450252cce169c42b516b73beabcfecca8b0f4102af1ffb972c61bcbf7bfcf";

for (const option of ["-c:a:", "-codec:a:"]) {
  it(`${option} selects independent streamhash encoders`, async () => {
    const result = await run("streamhash", [option + "0", "pcm_u8", option + "1", "pcm_s16be"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `0,a,SHA256=${u8}\n1,a,SHA256=${s16be}\n`);
  });
}

it("framecrc headers and payloads use each mapped audio encoder", async () => {
  const result = await run("framecrc", ["-c:a:0", "pcm_u8", "-c:a:1", "pcm_s16be"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_u8\n#sample_rate 0: 8000\n#channel_layout_name 0: stereo\n#tb 1: 1/8000\n#media_type 1: audio\n#codec_id 1: pcm_s16be\n#sample_rate 1: 8000\n#channel_layout_name 1: stereo\n0,          0,          0,       16,       32, 0x124a10b8\n1,          0,          0,       16,       64, 0x874b1af0\n");
});

it("the last matching encoder option wins", async () => {
  for (const args of [
    ["-c:a", "pcm_u8", "-c:a:1", "pcm_s16be"],
    ["-c:a:1", "pcm_u8", "-c:a", "pcm_s16be", "-c:a:0", "pcm_u8"],
    ["-c:a:0", "unknown", "-c", "pcm_u8", "-c:a:1", "pcm_s16be"],
    ["-c:a:0", "pcm_u8", "-c:a:1", "unknown", "-c:a:1", "pcm_s16be"]
  ]) {
    const result = await run("streamhash", args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `0,a,SHA256=${u8}\n1,a,SHA256=${s16be}\n`);
  }
});

it("validates selected indexed encoders", async () => {
  const result = await run("streamhash", ["-c:a:1", "unknown"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("Unknown encoder"), result.stderr);
  assert.equal(result.stdout, "");
});

for (const format of ["framehash", "framemd5", "streamhash"]) {
  it(`${format} keeps the default encoder for unmatched audio streams`, async () => {
    const control = await run(format, []);
    const result = await run(format, ["-c:a:0", "pcm_u8", "-c:a:9", "unknown"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("1,")),
      control.stdout.split("\n").filter(line => line.startsWith("1,")));
    assert.notDeepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")),
      control.stdout.split("\n").filter(line => line.startsWith("0,")));
  });
}

it("rejects malformed audio stream selectors", async () => {
  for (const option of ["-c:a:", "-c:a:-1", "-c:a:foo:0", "-codec:a:1.5"]) {
    const result = await run("streamhash", [option, "pcm_u8"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
  }
});

it("rejects indexed encoders for unsupported container output", async () => {
  const result = await run("wav", ["-c:a:0", "pcm_u8"]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
});
