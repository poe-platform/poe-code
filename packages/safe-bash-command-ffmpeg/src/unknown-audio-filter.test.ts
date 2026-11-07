import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const existing of [false, true]) {
  for (const option of ["-filter_complex", "-lavfi"]) {
    it(`${option} rejects unknown audio filters with ${existing ? "an existing" : "a fresh"} output`, async () => {
      const volume = Volume.fromJSON(existing ? { "/out.wav": "existing" } : {});
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([1000, 2000, 3000, 4000], sample => sample / 32768),
        Float64Array.from([-4000, -3000, -2000, -1000], sample => sample / 32768)
      ] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", option,
          "[0:a]no_filter_xyz[v]", "-map", "[v]", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("no_filter_xyz"));
      if (existing) assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
      else assert.equal(volume.existsSync("/out.wav"), false);
    });
  }
}
