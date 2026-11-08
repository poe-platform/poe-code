import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const count of [20, 1200]) for (const channels of [1, 2]) for (const pad of [0, 1]) {
  for (const format of ["framecrc", "wav"]) it(`pcm_rechunk ${format}: ${count} frames, ${channels} channels, pad=${pad}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: Array.from({ length: channels }, () => Float64Array.from({ length: count }, (_, i) => (i + 1) / 32768)) }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const n = count === 20 ? 8 : 700;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-c:a", "copy", "-bsf:a", `null,pcm_rechunk=n=${n}:p=${pad},null`, "-f", format, "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = Buffer.concat(chunks);
    const length = pad ? Math.ceil(count / n) * n : count;
    if (format === "wav") {
      assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.wav", "-c:a", "copy", "-bsf:a", `pcm_rechunk=n=${n}:p=${pad}`, "/out.wav"],
        undefined, path => fs.readFileSync(path) as Buffer,
        (path, bytes) => { fs.writeFileSync(path, bytes); return true; }), "");
      const syncAudio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.deepEqual(syncAudio.channelData, parseWav(output).tracks[0]!.decodedAudio!.channelData);
      const audio = parseWav(output).tracks[0]!.decodedAudio!;
      for (const channel of audio.channelData) assert.deepEqual(Array.from(channel),
        Array.from({ length }, (_, i) => i < count ? (i + 1) / 32768 : 0));
    } else {
      const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"));
      const expected = [];
      for (let start = 0; start < length; start += n) {
        const duration = Math.min(n, length - start);
        const bytes = new Uint8Array(duration * channels * 2);
        for (let i = 0; i < duration; i++) for (let c = 0; c < channels; c++) {
          new DataView(bytes.buffer).setInt16((i * channels + c) * 2, start + i < count ? start + i + 1 : 0, true);
        }
        let a = 0, b = 0;
        for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
        expected.push(["0", String(start), String(start), String(duration), String(bytes.length),
          `0x${(b * 65536 + a).toString(16).padStart(8, "0")}`]);
      }
      assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())), expected);
    }
  });
}

it("pcm_rechunk validates options and bounds packet allocation", async () => {
  const { filterBitstream } = await import("./bitstream.js");
  const { MediaBudgetTracker } = await import("@poe-code/mp4-ast");
  const tracks = parseWav(encodeWav({ sampleRate: 8000, channels: [new Float64Array(20)] })).tracks;
  for (const options of ["n=0", "n=-1", "n=1.5", "n=2147483648", "p=2", "unknown=1"]) {
    assert.throws(() => filterBitstream(tracks, `pcm_rechunk=${options}`, new MediaBudgetTracker(), "audio"));
  }
  assert.throws(() => filterBitstream(tracks, "pcm_rechunk=n=2147483647", new MediaBudgetTracker({ maxOutputBytes: 1024 }), "audio"), /maxOutputBytes/);
  assert.throws(() => filterBitstream(tracks, "pcm_rechunk=n=1", new MediaBudgetTracker({ maxSamplesPerTrack: 10 }), "audio"), /maxSamplesPerTrack/);
  const defaults = filterBitstream(tracks, "pcm_rechunk", new MediaBudgetTracker(), "audio")[0]!;
  assert.equal(defaults.samples[0]!.duration, 1024);
  assert.equal(defaults.samples[0]!.data.length, 2048);
  const aliases = filterBitstream(tracks, "pcm_rechunk=nb_out_samples=8:pad=false", new MediaBudgetTracker(), "audio")[0]!;
  assert.deepEqual(aliases.samples.map(sample => sample.duration), [8, 8, 4]);
});
