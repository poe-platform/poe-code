import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("reports ebur128 measurements at filtered PTS without changing loudness or samples", async () => {
  const sampleRate = 8000;
  const samples = Float64Array.from({ length: 28160 }, (_, i) =>
    (i < 28000 ? Math.round(8192 * Math.sin(2 * Math.PI * 1000 * i / sampleRate)) : 30000) / 32768);
  const input = encodeWav({ sampleRate, channels: [samples] });
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", input);
  let baseline: string[] | undefined;
  let summary: string | undefined;
  for (const [prefix, timestamp] of [
    ["", (frame: number) => frame],
    ["asetpts=PTS+2/TB,", (frame: number) => frame + 16000],
    ["asetpts=PTS-2/TB,", (frame: number) => frame - 16000],
    ["asetpts=PTS+2/TB,asetpts=PTS-STARTPTS,", (frame: number) => frame],
    // Frame-dependent PTS must be read at each report, not treated as one offset.
    ["asetnsamples=n=1024:p=0,asetpts=2*PTS,", (frame: number) => frame + Math.floor(frame / 1024) * 1024]
  ] as const) {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
        "-af", `${prefix}ebur128=peak=sample`, "-c:a", "pcm_s16le", "/out.wav"],
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
    const reports = stderr.split("\n").filter(line => line.startsWith("t:"));
    assert.equal(reports.length, 35, prefix);
    assert.deepEqual(reports.map(line => Number(line.slice(3).trim().split(" ")[0])),
      Array.from({ length: 35 }, (_, i) => timestamp((i + 1) * 800 - 1) / sampleRate), prefix);
    const measurements = reports.map(line => line.slice(line.indexOf("TARGET:")));
    baseline ??= measurements;
    assert.deepEqual(measurements, baseline, prefix);
    const actualSummary = stderr.slice(stderr.indexOf("Summary:"));
    summary ??= actualSummary;
    assert.equal(actualSummary, summary, prefix);
    assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData, prefix);
  }
});
