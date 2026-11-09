import assert from "node:assert/strict";
import { it } from "node:test";
import { gunzipSync } from "node:zlib";
import { Volume } from "memfs";
import fixtures from "./g711-demux-fixtures.json" with { type: "json" };
import { createFfmpegCommand } from "./index.js";

// FFmpeg 9.0.1 fixtures: codes.raw contains bytes 0..255.
// ffmpeg -f LAW -ar 8000 -ac 1 -i codes.raw -c:a copy -f CONTAINER input
// ffmpeg -i input -c:a pcm_s16le -f s16le output
// Inputs are gzip/base64; expected PCM is base64. No native executable is needed.
for (const [name, fixture] of Object.entries(fixtures)) {
  it(`decodes native ${name} and preserves stream copy`, async () => {
    const law = name.split("-")[0]!;
    const volume = Volume.fromJSON({ "/input": gunzipSync(Buffer.from(fixture.input, "base64")) });
    for (const copy of [false, true]) {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-i", "/input", "-c:a", copy ? "copy" : "pcm_s16le", "-f", copy ? law : "s16le", "/output"],
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
      assert.deepEqual(volume.readFileSync("/output"), copy
        ? Buffer.from(Array.from({ length: 256 }, (_, i) => i)) : Buffer.from(fixture.pcm, "base64"));
    }
  });
}
