import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { allMediaAsts, parseMp4, parseWav, wavAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [law, tag] of [["mulaw", "ulaw"], ["alaw", "alaw"]]) {
  for (const container of ["raw", "wav"]) {
    it(`stream copies ${container} ${law} to MOV without changing its encoding`, async () => {
      const codes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const source = allMediaAsts().find(ast => ast.id === law)!.parse(codes, { sampleRate: 8000, channels: 1, decodeAudio: false });
      const input = container === "wav" ? wavAst().serialize(source, { audioCodec: "copy" }) : codes;
      const volume = Volume.fromJSON({ "/input": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: [...(container === "raw" ? ["-f", law!, "-ar", "8000", "-ac", "1"] : []), "-i", "/input", "-c:a", "copy", "-f", "mov", "/out.mov"],
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
      assert.equal(track.codecDescriptions[0]!.formatFourCC, tag);
      assert.equal(track.codecDescriptions[0]!.codecName, `pcm_${law}`);
      assert.deepEqual(Buffer.concat(track.samples.map(sample => sample.data)), Buffer.from(codes));
      const wave = wavAst().serialize(output, { audioCodec: "copy" });
      assert.equal(parseWav(wave).tracks[0]!.codecDescriptions[0]!.codecName, `pcm_${law}`);
    });
  }
}
