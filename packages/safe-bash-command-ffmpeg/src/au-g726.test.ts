import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [encoding, hash] of [
  [23, "a8002983dba56c496c1b5dc08db95655dfb2ed71e06d206295ab1ccc8ae69d59"],
  [25, "19e12db301bc6628a3e0956e2bb36c88f470b1ecee029f2fba4a349204933aa2"],
  [26, "a111e21122712ace62896c65692f8b9b7b7f6579cb00cbf39dd6bca9472a2755"]
] as const) {
  for (const sync of [false, true]) {
    it(`transcodes AU G.726 encoding ${encoding} to native PCM (sync=${sync})`, async () => {
      const input = Buffer.alloc(47);
      [0x2e736e64, 32, 15, encoding, 8000, 1].forEach((value, i) => input.writeUInt32BE(value, i * 4));
      input.set(Buffer.from("12345678abcdef0112345678abcdef", "hex"), 32);
      const volume = Volume.fromJSON({ "/in.au": input, "/out.raw": "sentinel" });
      const args = ["-y", "-v", "error", "-i", "/in.au", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(createHash("sha256").update(volume.readFileSync("/out.raw") as Buffer).digest("hex"), hash);
    });
  }
}
