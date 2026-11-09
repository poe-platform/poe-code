import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(option: string) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/main.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(256).fill(8000 / 32768), new Float64Array(256).fill(-4000 / 32768)
  ] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 256 }, (_, i) => [0, 2048, 16384, 1000][Math.floor(i / 64)]! / 32768),
    new Float64Array(256)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/main.wav", "-i", "/key.wav", "-filter_complex",
      `[0:a][1:a]sidechaingate${option ? `=${option}` : ""}[out]`, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.wav") as Buffer };
}

for (const [option, expression, literal] of [
  ["level_in", "1/2", "0.5"],
  ["range", "1/4", "0.25"],
  ["threshold", "1/8", "0.125"],
  ["ratio", "2*2", "4"],
  ["attack", "2+3", "5"],
  ["release", "1k/2", "500"],
  ["makeup", "sqrt(4)", "2"],
  ["knee", "2^2", "4"],
  ["level_sc", "1/2", "0.5"]
]) {
  it(`sidechaingate evaluates ${option}=${expression} like ${literal}`, async () => {
    const decimal = await run(`${option}=${literal}`);
    assert.equal(decimal.result.exitCode, 0, decimal.stderr);
    const evaluated = await run(`${option}=${expression}`);
    assert.equal(evaluated.result.exitCode, 0, evaluated.stderr);
    assert.deepEqual(evaluated.output, decimal.output);
    if (option === "level_sc") {
      const audio = parseWav(evaluated.output).tracks[0]!.decodedAudio!;
      // Native FFmpeg 7.0.2 PCM16 reference for this stereo program/key pair.
      assert.deepEqual([64, 128, 192, 255].map(i => audio.channelData[0]![i]! * 32768), [490, 490, 6151, 5584]);
      const defaults = await run("");
      assert.equal(defaults.result.exitCode, 0, defaults.stderr);
      assert.notDeepEqual(evaluated.output, defaults.output);
    }
  });
}

for (const option of ["level_in=0b1", "range=0b1", "level_sc=0o1", "level_sc=1/0",
  "level_sc=0/0", "level_sc=1/", "level_sc=65/1", "level_sc=1/128", "level_sc=unknown"])
  it(`sidechaingate rejects ${option} without replacing output`, async () => {
    const { result, stderr, output } = await run(option);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes("sidechaingate:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
