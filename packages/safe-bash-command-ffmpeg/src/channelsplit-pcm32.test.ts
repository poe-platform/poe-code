import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exact native FFmpeg reference bytes, including both sample signs.
for (const [layout, channels, bits, selected, expected] of [
  ["quad", 4, 32, "FL", "a064740d609b8bf2"],
  ["5.1", 6, 32, "FL", "00514a1400afb5eb"],
  ["stereo", 2, 32, "FR", "2a9ab70ed66548f1"],
  ["quad", 4, 16, "FL", "2407dcf8"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native ${bits}-bit ${layout} channelsplit ${selected} (${graph ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      const header = Buffer.from("52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b7164617461ffffffff", "hex");
      header.writeUInt16LE(channels, 22);
      header.writeUInt32LE(8000 * channels * bits / 8, 28);
      header.writeUInt16LE(channels * bits / 8, 32);
      header.writeUInt16LE(bits, 34);
      header.writeUInt16LE(bits, 38);
      header.writeUInt32LE(layout === "quad" ? 0x33 : layout === "5.1" ? 0x3f : 3, 40);
      const samples = Buffer.alloc(2 * channels * bits / 8);
      for (const [frame, sign] of [1, -1].entries()) {
        for (let channel = 0; channel < channels; channel++) {
          samples.writeIntLE(sign * (channel + 1) * (bits === 32 ? 123456789 : 1000),
            (frame * channels + channel) * bits / 8, bits / 8);
        }
      }
      volume.writeFileSync("/in.wav", Buffer.concat([header, samples]));
      let stderr = "";
      const filter = `channelsplit=stereo:${selected}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", `pcm_s${bits}le`, "-f", `s${bits}le`, "/out.raw"],
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
