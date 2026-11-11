import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [chroma, samples, sampleBytes] of [
  ["420p10", 24, 2], ["420p12", 24, 2], ["422p10", 32, 2],
  ["444p12", 48, 2], ["444p10", 48, 2], ["420jpeg", 24, 1], ["422", 32, 1]
] as const) {
  it(`copies every byte of four C${chroma} Y4M frames to stdout`, async () => {
    const payloads = Array.from({ length: 4 }, (_, frame) => {
      const bytes = Buffer.alloc(samples * sampleBytes);
      for (let sample = 0; sample < samples; sample++) {
        if (sampleBytes === 2) bytes.writeUInt16LE(128 + frame + sample * 7, sample * 2);
        else bytes[sample] = 128 + frame + sample;
      }
      return bytes;
    });
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C${chroma}\n`),
      ...payloads.flatMap(bytes => [Buffer.from("FRAME\n"), bytes])]);
    const volume = Volume.fromJSON({ "/in.y4m": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.y4m", "-c:v", "copy", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(stdout), Buffer.concat(payloads));
    assert.equal(stderr, "");
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
