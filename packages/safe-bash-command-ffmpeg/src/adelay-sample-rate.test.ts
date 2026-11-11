import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [filter, length, hash] of [
    ["adelay=1S|4S,aformat=sample_rates=16000", 400, "4a42d6de334a618ebe4ce980091d8c50a56a34e6de278e2e4402b8e364932fd6"],
    ["adelay@delay=1S|4S,anull,aformat=r=16000", 400, "4a42d6de334a618ebe4ce980091d8c50a56a34e6de278e2e4402b8e364932fd6"],
    ["adelay=1S|4S,aformat=s16p:16000", 400, "4a42d6de334a618ebe4ce980091d8c50a56a34e6de278e2e4402b8e364932fd6"],
    ["adelay=1S|4S,aresample=16000,aformat=r=16000", 416, "b41ccbc0642bbabcaac1829984461a730112920fa944cc160a7899493803eb5d"],
    ["aformat=sample_rates=16000,adelay=1S|4S", 400, "4a42d6de334a618ebe4ce980091d8c50a56a34e6de278e2e4402b8e364932fd6"],
    ["adelay=1S|4S,aresample=16000", 416, "b41ccbc0642bbabcaac1829984461a730112920fa944cc160a7899493803eb5d"]
  ] as const) {
    it(`negotiates packed stereo rate: ${filter} (graph=${graph})`, async () => {
      const input = Buffer.alloc(44 + 48 * 4);
      input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
      input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(2, 22);
      input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
      input.writeUInt16LE(4, 32); input.writeUInt16LE(16, 34);
      input.write("data", 36); input.writeUInt32LE(192, 40);
      for (let i = 0; i < 48; i++) {
        input.writeInt16LE((i % 6 + 1) * 1000, 44 + i * 4);
        input.writeInt16LE(-(i % 6 + 1) * 1000, 46 + i * 4);
      }
      const fs = Volume.fromJSON({ "/in.wav": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, length);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
