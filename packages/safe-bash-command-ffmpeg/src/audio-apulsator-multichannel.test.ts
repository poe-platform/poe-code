import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: six-channel PCM16 automatically downmixed to stereo.
for (const graph of [false, true]) {
  for (const filter of [
    "apulsator=amount=0",
    "aformat=channel_layouts=stereo:sample_fmts=dbl,apulsator=amount=0"
  ]) {
    it(`${filter} matches every native six-channel frame (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(filter, "s16le", graph);
      assert.equal(output.length, 128);
      for (let frame = 0; frame < 32; frame++) {
        assert.equal(output.readInt16LE(frame * 4), 8586);
        assert.equal(output.readInt16LE(frame * 4 + 2), -2343);
      }
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "6a4a0136d2cf496222276a7ec3a7a7214bf07e91e67200dff9865330e4244931");
    });
  }
}

async function run(filter: string, format: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [10000, -8000, 2000, 1000, -4000, 6000].map(value => new Float64Array(32).fill(value / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.raw"],
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
