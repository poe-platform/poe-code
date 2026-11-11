import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { auAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const inherited of [false, true]) {
    it(`preserves AU album and PCM (${sync ? "sync" : "async"}, ${inherited ? "mapped WAV metadata" : "explicit metadata"})`, async () => {
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([100, -200, 300, -400], value => value / 32768)]
      }, inherited ? { tags: { title: "Song", album: "Record" } } : {});
      const volume = Volume.fromJSON({ "/input.wav": Buffer.from(input) });
      const args = ["-y", "-v", "error", "-i", "/input.wav", "-c:a", "pcm_s16be",
        ...(inherited ? ["-map_metadata", "0"] : ["-metadata", "title=Song", "-metadata", "album=Record"]),
        "-f", "au", sync ? "/out.au" : "pipe:1"];
      let output: Uint8Array;
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        output = volume.readFileSync("/out.au") as Buffer;
      } else {
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        output = Buffer.concat(chunks);
      }
      const offset = new DataView(output.buffer, output.byteOffset, output.byteLength).getUint32(4);
      assert.equal(new TextDecoder().decode(output.subarray(24, offset)).split("\0")[0], "Title=Song\nAlbum=Record");
      assert.equal(Buffer.from(output.subarray(offset)).toString("hex"), "0064ff38012cfe70");
      assert.deepEqual(auAst().parse(output).metadata, { title: "Song", album: "Record" });
    });
  }
}
