import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 raw s16le PCM for 1536 stereo frames at 8 kHz.
for (const [options, hash] of [
  ["1:level_in=1:0.5", "7a1fcd614df55b83cbf101de6fb6b168287c1511361b18cb18962780bf0f3123"],
  ["level_in=1:level_in=1:0.5", "7a1fcd614df55b83cbf101de6fb6b168287c1511361b18cb18962780bf0f3123"],
  ["level_in=1:level_out=0.5", "7a1fcd614df55b83cbf101de6fb6b168287c1511361b18cb18962780bf0f3123"],
  ["level_in=1:side_gain=0.5", "2cee45fa3f687a4affda87ed06d74286c4e196008dc3526f20e158d8247e8d52"],
  ["level_in=1:0.5", "7a1fcd614df55b83cbf101de6fb6b168287c1511361b18cb18962780bf0f3123"]
] as const) {
  for (const graph of [false, true]) {
    it(`haas=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const bytes = await run(options, graph);
      assert.equal(bytes.length, 6144);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    });
  }
}

for (const graph of [false, true]) {
  for (const options of ["2:level_in=2:0.5", "level_in=2:level_in=2:0.5"]) {
    it(`haas=${options} restarts positional options after a repeated key (${graph ? "graph" : "simple"})`, async () => {
      // Unequal input/output gains distinguish resetting to level_in from level_out.
      const expected = await run("level_in=0.5", graph);
      assert.deepEqual(await run(options, graph), expected);
      assert.notDeepEqual(await run("level_in=2:level_out=0.5", graph), expected);
    });
  }
}

async function run(options: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: Array.from({ length: 2 }, (_, channel) => Float64Array.from(
      { length: 1536 }, (_, i) => ((i * 421 + channel * 1709) % 12000 - 6000) / 32768
    ))
  }, { bitsPerSample: 16 }));
  let stderr = "";
  const filter = `haas=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
  return volume.readFileSync("/out.raw") as Buffer;
}
