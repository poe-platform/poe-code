import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 3.5 s of 700 Hz PCM16 tone, then 20 ms at 30000.
const sampleRate = 8000;
const samples = Float64Array.from({ length: 28160 }, (_, i) =>
  (i < 28000 ? Math.round(8192 * Math.sin(2 * Math.PI * 700 * i / sampleRate)) : 30000) / 32768);
const input = encodeWav({ sampleRate, channels: [samples] });

async function run(options: string) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
      "-af", `ebur128=peak=sample${options ? `:${options}` : ""}`, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

it("matches native ebur128 target and scale without changing the absolute summary or PCM", async () => {
  const baseline = await run("");
  assert.equal(baseline.exitCode, 0, baseline.stderr);
  const summary = baseline.stderr.slice(baseline.stderr.indexOf("Summary:"));
  assert.ok(summary.includes("I:         -15.4 LUFS"), summary);
  assert.ok(summary.includes("Peak:      -0.8 dBFS"), summary);
  for (const [options, target, relative] of [
    ["target=-16", -16, false],
    ["scale=relative", -23, true],
    ["target=-16:scale=relative", -16, true],
    ["scale=relative:target=-16", -16, true],
    ["target=-16:scale=absolute", -16, false],
    ["target=-23:scale=LUFS", -23, false],
    ["target=0:scale=LU", 0, true],
    ["target=-16:scale=0", -16, false],
    ["target=-16:scale=1", -16, true],
    ["target=-32/2:scale=relative", -16, true],
    ["target=-16.5:scale=relative", -16, true],
    ["target=-17.5:scale=relative", -18, true],
    ["scale=0.5", -23, false],
    ["target=-18:target=-16:scale=relative:scale=absolute", -16, false]
  ] as const) {
    const result = await run(options);
    assert.equal(result.exitCode, 0, `${options}: ${result.stderr}`);
    const reports = result.stderr.split("\n").filter(line => line.startsWith("t:"));
    assert.equal(reports.length, 35, options);
    const value = (-15.4 - (relative ? target : 0)).toFixed(1).padStart(6);
    const expected = `TARGET:${target} LUFS    M:${value} S:${value}     I:${value} ${relative ? "LU" : "LUFS"}       LRA:   0.0 LU  SPK: -12.0 dBFS`;
    assert.equal(reports.at(-1)!.slice(reports.at(-1)!.indexOf("TARGET:")), expected, options);
    const offset = relative ? target : 0;
    assert.ok(reports[0]!.includes(`M:${(-120.7 - offset).toFixed(1).padStart(6)} S:${(-120.7 - offset).toFixed(1).padStart(6)}     I:${(-70 - offset).toFixed(1).padStart(6)}`), reports[0]);
    assert.equal(result.stderr.slice(result.stderr.indexOf("Summary:")), summary, options);
    assert.deepEqual(parseWav(result.output).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData, options);
  }
});

it("rejects invalid ebur128 targets and scales before replacing output", async () => {
  for (const options of ["target=-24", "target=1", "target=-23.1", "target=0.1", "target=",
    "target=NaN", "target=Infinity", "target=bad", "scale=-1", "scale=2", "scale=", "scale=bad"]) {
    const result = await run(options);
    assert.equal(result.exitCode, 1, options);
    assert.ok(result.stderr.includes("ebur128:"), result.stderr);
    assert.equal(result.output.toString(), "keep", options);
  }
});
