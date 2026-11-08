import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { auAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg AU output for the five PCM16 samples, with Title/Artist annotation.
const native = Buffer.from("2e736e6400000038ffffffff0000000300001f40000000015469746c653d4e6565646c650a4172746973743d5465737465720000000000008000feff000001017fff", "hex");
for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    it(`${sync ? "sync" : "async"} preserves AU tags and PCM on ${copy ? "stream copy" : "explicit metadata write"}`, async () => {
      const input = copy ? "/in.au" : "/in.wav";
      const files = new Map<string, Uint8Array>([[input, copy ? native : encodeWav({
        sampleRate: 8000, channels: [Float64Array.from([-32768, -257, 0, 257, 32767], value => value / 32768)]
      })]]);
      const args = ["-i", input, "-c:a", copy ? "copy" : "pcm_s16be",
        ...(copy ? [] : ["-metadata", "title=New title", "-metadata", "artist=Renée"]), "/out.au"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => files.get(path),
          (path, bytes) => { files.set(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {},
          fs: {
            async readFile(path: string) { return files.get(path)!; },
            async writeFile(path: string, bytes: Uint8Array) { files.set(path, bytes); },
            async stat(path: string) {
              if (!files.has(path)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
              return { type: "file", size: files.get(path)!.length };
            }
          },
          stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
          signal: new AbortController().signal
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = files.get("/out.au")!;
      const offset = new DataView(output.buffer, output.byteOffset, output.byteLength).getUint32(4);
      assert.equal(new TextDecoder().decode(output.subarray(24, offset)).split("\0")[0],
        copy ? "Title=Needle\nArtist=Tester" : "Title=New title\nArtist=Renée");
      assert.deepEqual(output.subarray(offset), new Uint8Array(native.subarray(56)));
      assert.equal(auAst().parse(output).metadata.title, copy ? "Needle" : "New title");
      assert.equal(auAst().parse(output).metadata.artist, copy ? "Tester" : "Renée");
    });
  }
}
