import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 67 mono s16le samples at 8 kHz, repeating 0, 4000, 0, -4000.
const references = [
  { names: ["rect", "0"], half: "29e41f809bfe0e2a074e0e1e8611d7342e26a764493b97646e8bc6799fc35cc5",
    recommended: "ce5871e7efe0dbba24941f60de989f8ccb3304793b5ad81af9083d2a16965453" },
  { names: ["hann", "hanning", "1"], half: "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d",
    recommended: "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d" },
  { names: ["hamming", "2"], half: "409d7600d8fbfa9aaa328e47580ca78f1e8fdf001e50ccf5ea9b2d6846c25a08",
    recommended: "409d7600d8fbfa9aaa328e47580ca78f1e8fdf001e50ccf5ea9b2d6846c25a08" },
  { names: ["blackman", "3"], half: "6ed44502f96721bd69068b646662788ff52f93fa667c6b9ac4bbd0fc2b6a4e8d",
    recommended: "e96956aa2a796f5c0be58be4d0764c8d25022faeb676b396237d2d2fad466584" }
];

for (const reference of references) for (const name of reference.names) {
  for (const overlap of [0.5, 1]) for (const graph of [false, true]) {
    it(`matches native afftfilt win_func=${name}, overlap=${overlap}, graph=${graph}`, async () => {
      const input = Buffer.alloc(134);
      for (let i = 0; i < 67; i++) input.writeInt16LE([0, 4000, 0, -4000][i % 4]!, i * 2);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `afftfilt=win_size=16:overlap=${overlap}:win_func=${name}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.equal(output.length, 134);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        overlap === 0.5 ? reference.half : reference.recommended);
    });
  }
}
