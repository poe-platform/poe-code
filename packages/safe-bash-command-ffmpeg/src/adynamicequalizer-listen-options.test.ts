import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/adynamicequalizer-input.wav", import.meta.url));
const reference = parseWav(readFileSync(new URL("./fixtures/adynamicequalizer-listen.wav", import.meta.url)))
  .tracks[0]!.decodedAudio!;

// FFmpeg 7.0.2 validates these settings but they do not change the listen signal.
const validOptions = [
  "tfrequency=1000", "attack=20", "threshold=5",
  "tfrequency=2", "tfrequency=1M", "tqfactor=0.001", "tqfactor=1000",
  "attack=0.01", "attack=2000", "release=0.01", "release=2000",
  "threshold=0", "threshold=100", "ratio=0", "ratio=30",
  "makeup=0", "makeup=1000", "range=1", "range=2000",
  "tftype=bell", "tftype=lowshelf", "tftype=highshelf", "tftype=1+1",
  "auto=disabled", "auto=off", "auto=on", "auto=adaptive", "auto=2+2",
  "tfrequency=2k:tqfactor=1/2:attack=10*2:release=500:threshold=5:ratio=3:makeup=10:range=20:tftype=highshelf:auto=adaptive"
];
const invalidOptions = [
  "tfrequency=1", "tfrequency=1000001", "tqfactor=0", "tqfactor=1001",
  "attack=0", "attack=2001", "release=0", "release=2001",
  "threshold=-1", "threshold=101", "ratio=-1", "ratio=31",
  "makeup=-1", "makeup=1001", "range=0", "range=2001",
  "tftype=-1", "tftype=2.1", "tftype=bandpass", "auto=0.9", "auto=5", "auto=invalid",
  "attack=", "threshold=NaN", "tfrequency=1/0", "range=garbage",
  "attack=0:attack=20"
];

for (const graph of [false, true]) {
  for (const options of validOptions) {
    it(`preserves native detector PCM with ${options} (${graph ? "graph" : "simple"})`, async () => {
      const { fs, result, stderr } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, reference.sampleRate);
      assert.deepEqual(audio.channelData, reference.channelData);
    });
  }
  for (const options of invalidOptions) {
    it(`rejects ${options} before replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { fs, result, stderr } = await run(options, graph);
      assert.equal(result.exitCode, 1);
      assert.match(stderr, /adynamicequalizer/);
      assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
    });
  }
}

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.wav": "KEEP" });
  const filter = `adynamicequalizer=mode=listen:${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { fs, result, stderr };
}
