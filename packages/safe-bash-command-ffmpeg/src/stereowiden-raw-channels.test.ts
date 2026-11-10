import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references, with channel counts but no named input layout.
for (const complex of [false, true]) {
  for (const [channels, filter, bytes, sha256] of [
    [4, "stereowiden=delay=1", 144, "456ec40967dd91dbb810856a8b0aa9a2dbb9745ff87f4f637c988adc2b2fcc9b"],
    [6, "stereowiden=delay=1", 96, "0167a6e8c0805e3c474ef76c97562389c0c5bd8f12117ba8374b94d29b27c5d0"],
    [3, "stereowiden=delay=1", 192, "d037dab844153773cc6d6b39e43adc3fa1189d56a3223e541b59c7dafe9178a2"],
    [4, "anull", 288, "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13"],
    [6, "anull", 288, "25e58d6b487c539be75ca5170556cae39d310ac4ce1666620fe2783c9d5dfe13"],
    [2, "stereowiden=delay=1", 288, "205e332d41aa8f7d101c8267eae669090b3b45331395a775d3b9dc86934a185a"]
  ] as const) {
    it(`negotiates ${channels}-channel raw PCM for ${filter} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(288);
      for (let i = 0; i < 72; i++) {
        input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
        input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      assert.equal(output.length, bytes);
      assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
    });
  }
}
