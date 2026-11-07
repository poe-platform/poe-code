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

for (const existing of [false, true]) {
  it(`rejects a nonexistent two-input audio filter with ${existing ? "an existing" : "a fresh"} output`, async () => {
    const volume = Volume.fromJSON(existing ? { "/out.wav": "existing" } : {});
    for (const [path, samples] of [
      ["/a.wav", Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192)],
      ["/b.wav", Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024)]
    ] as const) {
      volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
    }
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", "[0:a][1:a]zzzauditnofilter[mix]", "-map", "[mix]",
        "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.ok(Buffer.concat(errors).length > 0);
    if (existing) assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
    else assert.equal(volume.existsSync("/out.wav"), false);
  });
}
