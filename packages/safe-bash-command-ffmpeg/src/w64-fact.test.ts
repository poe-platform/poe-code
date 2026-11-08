import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const frames of [4, 5]) {
  for (const codec of ["pcm_f32le", "pcm_f64le", "pcm_mulaw", "pcm_alaw", "pcm_s16le"]) {
    it(`writes native Wave64 fact count for ${frames} frames of ${codec}`, async () => {
      const input = Buffer.from("524946462c00000057415645666d74201000000001000100401f0000803e00000200100064617461080000000a00ecff1e00d8ff3200", "hex").subarray(0, 44 + frames * 2);
      input.writeUInt32LE(input.length - 8, 4);
      input.writeUInt32LE(frames * 2, 40);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", codec, "/out.w64"],
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
      const output = volume.readFileSync("/out.w64") as Buffer;
      const fact = output.indexOf(Buffer.from("66616374f3acd3118cd100c04f8edb8a", "hex"));
      if (codec === "pcm_s16le") assert.equal(fact, -1);
      else {
        assert.ok(fact >= 0);
        assert.equal(output.readBigUInt64LE(fact + 16), 32n);
        assert.equal(output.readBigUInt64LE(fact + 24), BigInt(frames));
      }
    });
  }
}
