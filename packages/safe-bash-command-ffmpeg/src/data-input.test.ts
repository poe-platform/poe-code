import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand, evalSyncFfmpeg } from "./index.js";

// The native fixture contains 64 stereo PCM16 frames: (1, -1) through (64, -64).
const wav = Buffer.alloc(300);
Buffer.from("524946462401000057415645666d74201000000001000200401f0000007d0000040010006461746100010000", "hex").copy(wav);
for (let frame = 0; frame < 64; frame++) {
  wav.writeInt16LE(frame + 1, 44 + frame * 4);
  wav.writeInt16LE(-frame - 1, 46 + frame * 4);
}

for (const mime of ["audio/wav", "application/octet-stream"]) {
  for (const mode of ["pcm", "seek", "probe", "explicit-probe"]) {
    it(`reads inline ${mime} input for ${mode} without a filesystem entry`, async () => {
      const input = `data:${mime};base64,${wav.toString("base64")}`;
      const probe = mode.includes("probe");
      const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
      let stdout = "", stderr = "";
      const args = probe
        ? ["-v", "error", ...(mode === "explicit-probe" ? ["-f", "wav"] : []), "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts:format=size", "-of", "json", input]
        : ["-v", "error", "-y", ...(mode === "seek" ? ["-ss", "0.003"] : []), "-i", input, ...(mode === "seek" ? ["-t", "0.002"] : []), "-f", "s16le", "/out.pcm"];
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      if (probe) assert.deepEqual(JSON.parse(stdout), {
        programs: [], stream_groups: [], streams: [{ codec_name: "pcm_s16le", sample_rate: "8000", channels: 2 }], format: {}
      });
      else assert.deepEqual(volume.readFileSync("/out.pcm"), mode === "seek" ? wav.subarray(44 + 24 * 4, 44 + 40 * 4) : wav.subarray(44));
    });
  }
}

it("declines synchronous inline evaluation without reading a literal protocol filename", () => {
  const reads: string[] = [];
  const output = evalSyncFfmpeg(undefined, ["-y", "-i", `data:audio/wav;base64,${wav.toString("base64")}`, "-f", "s16le", "pipe:1"], path => {
    reads.push(path); return wav;
  });
  assert.equal(output, undefined);
  assert.deepEqual(reads, []);
});
