import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { allMediaAsts, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const codec of ["copy", "pcm_s16le"]) {
  for (const container of ["raw", "caf"]) {
    it(`writes ${container} PCM to MOV with ${codec} and preserves every sample`, async () => {
      const codes = Buffer.alloc(8200 * 4);
      for (let i = 0; i < 8200; i++) {
        codes.writeInt16LE(i, i * 4);
        codes.writeInt16LE(111, i * 4 + 2);
      }
      const source = allMediaAsts().find(ast => ast.id === "s16le")!.parse(codes, { sampleRate: 8000, channels: 2, decodeAudio: false });
      const input = container === "caf" ? allMediaAsts().find(ast => ast.id === "caf")!.serialize(source, { audioCodec: "copy" }) : codes;
      const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...(container === "raw" ? ["-f", "s16le", "-ar", "8000", "-ac", "2"] : []), "-i", "/input", "-c:a", codec!, "-f", "mov", "/out.mov"],
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
      const output = parseMp4(volume.readFileSync("/out.mov") as Buffer, { decodeAudio: false });
      const track = output.tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.formatFourCC, "sowt");
      assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(codes));
      assert.equal(track.duration, 8200);
      assert.equal(track.timescale, 8000);
      assert.equal(track.codecDescriptions[0]!.channels, 2);
    });
  }
}
