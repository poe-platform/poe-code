import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [format, codec, valid] of [
    ["s16le", "pcm_s16be", false],
    ["s16le", "pcm_s24le", false],
    ["s16le", "pcm_f64le", false],
    ["u8", "copy", false],
    ["s16le", "copy", true],
    ["s16le", "pcm_s16le", true],
    ["u8", undefined, true]
  ] as const) {
    it(`validates raw ${format} to s16le with ${codec ?? "default"} codec (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Buffer.from(format === "u8" ? "004080c0ff" : "008000c000000040007f", "hex"));
      const args = ["-y", "-v", "error", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(codec ? ["-c:a", codec] : []), "-f", "s16le", "/out.raw"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), valid ? "" : undefined);
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
        assert.equal(result.exitCode === 0, valid, stderr);
        if (!valid) assert.match(stderr, /s16le muxer supports only codec pcm_s16le/);
      }
      if (valid) assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("008000c000000040007f", "hex"));
      else if (sync) assert.equal(volume.existsSync("/out.raw"), false);
      else assert.equal((volume.readFileSync("/out.raw") as Buffer).length, 0);
    });
  }
}
