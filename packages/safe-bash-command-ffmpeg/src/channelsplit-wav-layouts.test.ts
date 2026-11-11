import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 speaker selections from extensible PCM16 WAV inputs.
for (const [mask, count, layout, speaker, expected] of [
  [0x107, 4, "4.0", "BC", "a00f60f0"],
  [0x10f, 5, "4.1", "LFE", "a00f60f0"],
  [0x37, 5, "5.0", "BR", "881378ec"],
  [0x607, 5, "5.0(side)", "SR", "881378ec"],
  [0x70f, 7, "6.1", "BC", "881378ec"],
  [0x737, 8, "octagonal", "BC", "701790e8"],
  [0x33, 4, "quad", "BL", "b80b48f4"]
] as const) {
  for (const graph of [false, true]) {
    it(`extracts ${layout}:${speaker} from a matching WAV (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(68 + count * 4);
      input.set(Buffer.from("524946460000000057415645666d742028000000feff0000401f0000000000000000100016001000000000000100000000001000800000aa00389b716461746100000000", "hex"));
      input.writeUInt32LE(input.length - 8, 4);
      input.writeUInt16LE(count, 22);
      input.writeUInt32LE(8000 * count * 2, 28);
      input.writeUInt16LE(count * 2, 32);
      input.writeUInt32LE(mask, 40);
      input.writeUInt32LE(count * 4, 64);
      for (const [frame, sign] of [1, -1].entries()) {
        for (let channel = 0; channel < count; channel++) {
          input.writeInt16LE(sign * (channel + 1) * 1000, 68 + (frame * count + channel) * 2);
        }
      }
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      let stderr = "";
      const filter = `channelsplit=${layout}:${speaker}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
