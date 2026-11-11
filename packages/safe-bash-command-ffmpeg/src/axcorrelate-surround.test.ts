import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from native FFmpeg 7.0.2, size=3:algo=fast.
for (const [first, second, expected] of [
  [1, 6, "7ed6b6e7681d056901154230c8679b669f54a9cabcac0080"],
  [6, 1, "1a34ffba3f0e6999a06a8b89b302d54aecb668425ebaf1c413ac583383fdb1c1"],
  [6, 2, "0d54b740e6ecb53c882cadbe77bcaa61639c25effd723f720d94b98f18753f0f"],
  [2, 6, "a6e98fb2f7317747d2fb0433d935d2ceaf450a60a6bb520eae1f1c983a009f6c"],
  [6, 6, "e700b6bcde490475a1e5869cfc9383f1efd7f7a3ea771ce1c61cf3d71deced7d"],
  [2, 1, "d14f4f653e721a8a8b49aba039ed2e130c8e80ca52b5e8a3c56a39dc2c55275c"]
] as const) {
  it(`axcorrelate matches native complete PCM for ${first}/${second} channels`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, channels, step] of [["a", first, 137], ["b", second, 193]] as const) {
      const bytes = Buffer.alloc(12 * channels * 2);
      for (let i = 0; i < 12; i++) for (let c = 0; c < channels; c++) {
        bytes.writeInt16LE(((i * step + 600 * c + 7 * i * c) % 1700) - 850, (i * channels + c) * 2);
      }
      volume.writeFileSync(`/${name}.raw`, bytes);
    }
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(first), "-i", "/a.raw",
        "-f", "s16le", "-ar", "8000", "-ac", String(second), "-i", "/b.raw",
        "-filter_complex", "[0:a][1:a]axcorrelate=size=3:algo=fast[o]", "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    assert.equal(bytes.length, 12 * first * 2);
    assert.equal(first === 1 ? bytes.toString("hex") : createHash("sha256").update(bytes).digest("hex"), expected);
  });
}
