import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 256 mono PCM16 samples with bytes (31 * i + 7) % 256.
for (const [inputRate, options, bytes, hash] of [
  [5512, [], 1488, "802ece24e6743d96ab911797431d8f182d9e1694bcc57e411fad671f5f45f225"],
  [5512, ["-linear_interp", "0"], 1488, "c795fedadbc383999bb900a756f565053dba695a71c5b2a6c665f43f96693230"],
  [8000, [], 1024, "d51794dac650fbe1f432cd21148b6d9f7f47f25105f300d5056ae47526c5ef30"]
] as const) {
  it(`matches native PCM16 phase rounding from ${inputRate} Hz with ${options.join(" ") || "default interpolation"}`, async () => {
    const pcm = Buffer.from(Array.from({ length: 512 }, (_, i) => (31 * i + 7) % 256));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", String(inputRate), "-ac", "1", "-i", "/in.pcm",
        "-bitexact", "-ar", "16000", ...options, "-f", "s16le", "/out.pcm"],
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
    assert.equal(stderr, "");
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, bytes);
    if (inputRate === 5512 && options.length === 0) assert.equal(output.readInt16LE(629 * 2), -6605);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
