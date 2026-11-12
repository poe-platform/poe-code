import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(32);
[32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128]
  .forEach((sample, index) => input.writeInt16LE(sample, index * 2));
// Native FFmpeg 7.0.2 output for the inline stereo PCM fixture.
const picture = Buffer.from("00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000", "hex");

async function run(graph: string, format: string, options: string[] = []) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      "-filter_complex", graph, ...options, "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", format, "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const format of ["framecrc", "framemd5", "framehash"]) {
  for (const selection of ["automatic", "mapped picture", "disabled audio"]) {
    it(`preserves showwavespic stream selection for ${format}: ${selection}`, async () => {
      const mapped = selection === "mapped picture";
      const automatic = selection === "automatic";
      const result = await run(`[0:a]showwavespic=s=2x4${mapped ? "[pic]" : ""}`, format,
        mapped ? ["-map", "[pic]"] : automatic ? [] : ["-an"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      const lines = result.stdout.toString().trimEnd().split("\n");
      assert.deepEqual(lines.filter(line => line.startsWith("#") && !line.startsWith("#format:") &&
        !line.startsWith("#version:") && !line.startsWith("#hash:") && !line.startsWith("#stream#")), [
        "#tb 0: 1/1", "#media_type 0: video", "#codec_id 0: rawvideo", "#dimensions 0: 2x4", "#sar 0: 1/1",
        ...(automatic ? ["#tb 1: 1/8000", "#media_type 1: audio", "#codec_id 1: pcm_s16le",
          "#sample_rate 1: 8000", "#channel_layout_name 1: stereo"] : [])
      ]);
      const digest = (bytes: Buffer, crc: string) => format === "framecrc" ? crc :
        createHash(format === "framemd5" ? "md5" : "sha256").update(bytes).digest("hex");
      assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(value => value.trim())), [
        ["0", "0", "0", "1", "32", digest(picture, "0x472503b8")],
        ...(automatic ? [["1", "0", "0", "8", "32", digest(input, "0xc4870c11")]] : [])
      ]);
    });
  }

  it(`rejects an unbound showwavespic input already selected for ${format} audio`, async () => {
    const result = await run("showwavespic=s=2x4", format);
    assert.equal(result.exitCode, 234);
    assert.equal(result.stdout.length, 0);
    assert.ok(result.stderr.includes("Cannot find a matching stream for unlabeled input pad showwavespic:default"), result.stderr);
  });
}

it("keeps unbound showwavespic available when audio output is disabled", async () => {
  const result = await run("showwavespic=s=2x4", "framecrc", ["-an"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(!result.stdout.toString().includes("#media_type 1:"));
  assert.ok(result.stdout.toString().includes("0x472503b8"));
});

it("preserves unbound showwavespic rawvideo output", async () => {
  const result = await run("showwavespic=s=2x4", "rawvideo");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout, picture);
});

it("keeps automatic checksum audio separate from upstream waveform filters", async () => {
  const result = await run("[0:a]volume=0,showwavespic=s=2x4", "framecrc");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.toString().trimEnd().split("\n").filter(line => !line.startsWith("#")), [
    "0,          0,          0,        1,       32, 0x00000000",
    "1,          0,          0,        8,       32, 0xc4870c11"
  ]);
});

it("binds an unlabeled waveform to audio not already selected for checksum output", async () => {
  const result = await run("showwavespic=s=2x4", "framecrc",
    ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.toString().includes("#channel_layout_name 1: stereo\n"));
  assert.deepEqual(result.stdout.toString().trimEnd().split("\n").filter(line => !line.startsWith("#")), [
    "0,          0,          0,        1,       32, 0x51ae03fc",
    "1,          0,          0,        8,       32, 0xc4870c11"
  ]);
});
