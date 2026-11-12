import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2-static: mono PCM16, 8 kHz, desired signal delayed by three samples.
const input = Buffer.alloc(2400);
for (let i = 0; i < 1200; i++) input.writeInt16LE(i * 7919 % 22001 - 11000, i * 2);
const passthrough = "5e96d5056dc33e5bbc56f467d0ae9f6013aaf3d14e8b114134c69c3270779e39";
for (const [name, ordinary, timed] of [
  ["anlms", "dd3951557c3cb7309a5e7cc79183661ceb68dc7b5da64952979c630173370af5",
    "3607ae908029b0d3f6a9c351f14b43700eebc8500369ab5dc34f8dc3bff46847"],
  ["anlmf", "91f79a4404a9f6b9897426d3acabd7713961ee85c50ed0f3162c427aa8b094a6",
    "bd6e912fba8f1efdb9e537c82357b71bfab416264936faa6a43fef057fde4fbe"]
] as const) {
  for (const [options, hash] of [
    ["", ordinary], [":out_mode=i", passthrough], [":enable=0", passthrough],
    [":enable=1", ordinary], [":enable=gte(t\\,0.064)", timed],
    [":enable='gte(t,0.064)'", timed]
  ]) {
    it(`${name}${options} matches native adaptive timeline PCM`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-filter_complex", `[0:a]asplit[a][b];[a]anull[x];[b]adelay=3S[y];[x][y]${name}=order=4${options}[out]`,
          "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = Buffer.concat(chunks);
      assert.equal(pcm.length, input.length);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
