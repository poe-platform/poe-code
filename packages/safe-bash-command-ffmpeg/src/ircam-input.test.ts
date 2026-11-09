import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg attachment: 16 stereo PCM16 frames, 8 kHz, 1024-byte IRCAM header.
const pcm = Buffer.from("480000fcac00ecfb1001d8fb7401c4fbd801b0fb3c029cfba00288fb040374fb680360fbcc034cfb300438fb940424fbf80410fb5c05fcfac005e8fa2406d4fa", "hex");

for (const format of ["s16le", "mulaw", "alaw"]) {
  for (const explicit of [false, true]) {
    for (const sync of [false, true]) {
      it(`decodes native IRCAM ${format}, explicit=${explicit}, sync=${sync}`, async () => {
        const payload = format === "s16le" ? pcm : Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        const input = Buffer.alloc(1024 + payload.length);
        Buffer.from("64a301000000fa450200000002000000", "hex").copy(input);
        input.writeUInt32LE(format === "s16le" ? 2 : 1, 8);
        input.writeUInt32LE(format === "s16le" ? 2 : format === "mulaw" ? 0x20001 : 0x10001, 12);
        payload.copy(input, 1024);
        const volume = Volume.fromJSON({ "/decoded.raw": "keep" });
        volume.writeFileSync("/input", input);
        volume.writeFileSync("/raw", payload);
        const run = async (args: string[]) => {
          if (sync) return evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
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
          return result.exitCode === 0 ? "" : stderr;
        };
        const args = ["-v", "error", "-y", ...(explicit ? ["-f", "ircam"] : []),
          "-i", "/input", "-c:a", "pcm_s16le", "-f", "s16le", "/decoded.raw"];
        assert.equal(await run(args), "");
        assert.equal(await run(["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", format === "s16le" ? "2" : "1",
          "-i", "/raw", "-c:a", "pcm_s16le", "-f", "s16le", "/expected.raw"]), "");
        assert.deepEqual(volume.readFileSync("/decoded.raw"), volume.readFileSync("/expected.raw"));
        input.fill(0, 0, 8);
        volume.writeFileSync("/input", input);
        volume.writeFileSync("/decoded.raw", "keep");
        assert.notEqual(await run(args), "");
        assert.equal(volume.readFileSync("/decoded.raw", "utf8"), "keep");
      });
    }
  }
}
