import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { listenDynamicEqualizer } from "./audio-adynamicequalizer.js";
import { createFfmpegCommand } from "./index.js";

// Python random.Random(45): 8192 randrange(-32768, 32768) samples, mono PCM16 at 16 kHz.
const input = readFileSync(new URL("./fixtures/adynamicequalizer-precision-input.wav", import.meta.url));
// Native FFmpeg 7.0.2: -i input.wav -af adynamicequalizer=mode=listen:precision=VALUE -f s16le -
const hashes = {
  float: "00e64a085bd7c70ada266bf8aa4e55f0d1e36091de610ea0c00a36957aad8456",
  double: "6ed7669c6ed324cfe80e4acd0e05d54ec2fd40cc350335a6d40679e20b5c98a3"
};

for (const graph of [false, true]) {
  for (const precision of ["", "auto", "float", "double", "0", "1", "2"]) {
    it(`matches native PCM with ${precision || "default"} precision (${graph ? "graph" : "simple"})`, async () => {
      const { pcm } = await run(`adynamicequalizer=mode=listen${precision ? `:precision=${precision}` : ""}`, graph);
      const double = precision === "double" || precision === "2";
      assert.equal(pcm!.readInt16LE(1733 * 2), double ? -10889 : -10888);
      assert.equal(createHash("sha256").update(pcm!).digest("hex"), double ? hashes.double : hashes.float);
    });
  }
  for (const format of ["flt", "fltp", "dbl", "dblp", "s64"]) {
    it(`selects auto precision from ${format} input (${graph ? "graph" : "simple"})`, async () => {
      const { pcm } = await run(`aformat=sample_fmts=${format},adynamicequalizer=mode=listen:precision=auto`, graph);
      assert.equal(createHash("sha256").update(pcm!).digest("hex"), format.startsWith("flt") ? hashes.float : hashes.double);
    });
  }
}

for (const precision of ["invalid", "", "-1", "3", "NaN", "1/0"]) {
  it(`rejects invalid precision ${JSON.stringify(precision)} without overwriting output`, async () => {
    const { result, stderr, fs } = await run(`adynamicequalizer=mode=listen:precision=${precision}`, false, false);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /adynamicequalizer/);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}

it("accounts for double output memory and honors cancellation", async () => {
  const channels = [new Float32Array(32)];
  const filter = "adynamicequalizer=mode=listen:precision=double";
  await assert.rejects(listenDynamicEqualizer(channels, 16000, filter,
    new MediaBudgetTracker({ maxMemoryBytes: 128 })), /maxMemoryBytes/);
  await assert.rejects(listenDynamicEqualizer(channels, 16000, filter,
    new MediaBudgetTracker(), AbortSignal.abort()));
});

async function run(filter: string, graph = false, success = true) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", input);
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
  let pcm: Buffer | undefined;
  if (success) {
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channels, 1);
    assert.equal(audio.channelData[0]!.length, 8192);
    pcm = Buffer.alloc(8192 * 2);
    audio.channelData[0]!.forEach((sample, i) => pcm!.writeInt16LE(sample * 32768, i * 2));
  }
  return { result, stderr, fs, pcm };
}
