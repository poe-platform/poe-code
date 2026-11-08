import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { flacAst, oggAst, wavAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.alloc(4096 * 4);
for (let i = 0; i < 4096; i++) {
  const x = i * 149 % 30000 - 15000;
  pcm.writeInt16LE(x, i * 4);
  pcm.writeInt16LE(x + i % 31 - 15, i * 4 + 2);
}

for (const sync of [false, true]) it(`${sync ? "sync" : "async"} exact Rice selection changes coding while preserving PCM`, async () => {
  for (const extension of ["flac", "ogg"]) {
    const outputs: Buffer[] = [];
    for (const value of ["0", "1", "2", "-1", "0.5", "invalid", ""]) {
      const valid = value === "0" || value === "1";
      const volume = Volume.fromJSON({ "/in.pcm": pcm });
      const args = ["-y", "-f", "s16le", "-ar", "16000", "-ac", "2", "-i", "/in.pcm",
        "-c:a", "flac", "-exact_rice_parameters", value, `/out.${extension}`];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, valid ? "" : undefined);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode === 0, valid, stderr);
      }
      if (!valid) { assert.equal(volume.existsSync(`/out.${extension}`), false); continue; }
      const bytes = volume.readFileSync(`/out.${extension}`) as Buffer;
      outputs.push(bytes);
      const doc = flacAst().parse(extension === "flac" ? bytes : oggAst().parse(bytes).tracks[0]!.samples[0]!.data, { decodeAudio: true });
      const decoded = wavAst().parse(wavAst().serialize(doc, { audioCodec: "pcm_s16le" }), { decodeAudio: true }).tracks[0]!.decodedAudio!;
      for (let i = 0; i < 4096; i++) for (let channel = 0; channel < 2; channel++) {
        assert.equal(Math.round(decoded.channelData[channel]![i]! * 32768), pcm.readInt16LE(i * 4 + channel * 2));
      }
    }
    assert.equal(outputs[0]!.equals(outputs[1]!), false);
    assert.ok(outputs[1]!.length <= outputs[0]!.length);
  }
});
