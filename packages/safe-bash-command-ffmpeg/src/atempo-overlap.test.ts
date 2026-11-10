import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 PCM outputs, including overlap feathering.
for (const [pattern, length, tempo, samples, hash] of [
  ["flat", 3072, 2, 1536, "e799fdc957cb3a182dae16c948531a4282f4dd785950044d8bc384e969e8dd3e"],
  ["tone", 4096, 2, 2048, "f61092627006577921c7b7bf99182b6fde465a25eff9b50a490348c9e217c6dc"],
  ["flat", 3072, 1, 3055, "76d777b197ffc309009e58616e84776b19d1a7b2ee73706c286b6ab80345ea25"],
  ["tone", 4096, 1, 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"]
] as const) {
  it(`matches native atempo=${tempo} overlap PCM for ${pattern}`, async () => {
    const input = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) input.writeInt16LE(pattern === "flat" ? 16000 : ((i % 32) - 16) * 800, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", "-af", `atempo=${tempo}`, "-f", "s16le", "/out"],
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
    const output = volume.readFileSync("/out") as Buffer;
    assert.equal(output.length, samples * 2);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
