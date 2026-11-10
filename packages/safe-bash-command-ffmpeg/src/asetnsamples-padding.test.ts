import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const payload = Buffer.alloc(4707 * 2);
for (let i = 0; i < 4707; i++) payload.writeInt16LE(i - 2000, i * 2);
const input = Buffer.alloc(44 + payload.length);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
input.write("data", 36); input.writeUInt32LE(payload.length, 40); payload.copy(input, 44);

// Native FFmpeg 7.0.2 pads this fixture to 4864 samples.
for (const graph of [false, true]) {
  for (const [options, pad] of [
    ["n=256:p=TRUE", true], ["n=256:p=On", true],
    ["n=256:p=true", true], ["n=256:p=1", true],
    ["n=256:pad=YeS", true], ["256:TrUe", true],
    ["n=256:p=FALSE", false], ["n=256:pad=Off", false],
    ["256:No", false], ["n=256:p=0", false],
    ["n=256:p=invalid", undefined]
  ] as const) {
    it(`asetnsamples=${options} accepts case-insensitive padding (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=${options},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (pad === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const samples = pad ? 4864 : 4707;
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, samples * 2);
      if (pad) assert.equal(createHash("sha256").update(output).digest("hex"),
        "7238ab5b14671e505cd901c9903d697548beb72251cc5821f4099b828bc2d67c");
      const frames = Array.from(stderr.matchAll(/n:(\d+).*?pts:(\d+).*?nb_samples:(\d+)/g),
        match => match.slice(1).map(Number));
      assert.deepEqual(frames, Array.from({ length: 19 }, (_, i) =>
        [i, i * 256, !pad && i === 18 ? 99 : 256]));
      assert.deepEqual(output.subarray(0, payload.length), payload);
      assert.deepEqual(output.subarray(payload.length), Buffer.alloc((samples - 4707) * 2));
    });
  }
}
