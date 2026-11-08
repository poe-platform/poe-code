import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: 4000 signed PCM samples at 8 kHz. A failed seek beyond EOF
// leaves the demuxer at its final 512-frame packet, starting at sample 3584.
for (const codec of ["copy", "pcm_s16le"]) {
  for (const format of ["s16le", "wav"]) {
    for (const [seek, first] of [["0.1", 800], ["0.499875", 3999], ["0.5", 4000], ["1.0", 3584]] as const) {
      it(`raw input seek ${seek} with ${codec} to ${format} matches native PCM bytes`, async () => {
        const input = Buffer.alloc(8000);
        for (let i = 0; i < 4000; i++) input.writeInt16LE(i, i * 2);
        const volume = Volume.fromJSON({ "/input.raw": input });
        const args = ["-f", "s16le", "-ar", "8000", "-ac", "1", "-ss", seek,
          "-i", "/input.raw", "-c:a", codec, "-f", format, "/output"];
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          () => { assert.fail("raw input seeking must use the async path"); }), undefined);
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
        const output = volume.readFileSync("/output") as Buffer;
        const pcm = format === "wav"
          ? Buffer.concat(parseWav(output).tracks[0]!.samples.map(sample => sample.data)) : output;
        assert.deepEqual(pcm, input.subarray(first * 2));
      });
    }
  }
}
