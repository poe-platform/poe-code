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

for (const sync of [false, true]) for (const mode of ["indep", "left_side", "right_side", "mid_side", "invalid"]) {
  it(`${sync ? "sync" : "async"} FLAC ch_mode ${mode} controls real packets and preserves PCM`, async () => {
    const valid = mode !== "invalid";
    for (const extension of ["flac", "ogg"]) {
      const volume = Volume.fromJSON({ "/in.pcm": pcm });
      const args = ["-y", "-f", "s16le", "-ar", "16000", "-ac", "2", "-i", "/in.pcm",
        "-c:a", "flac", "-ch_mode", mode, `/out.${extension}`];
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
      const plugin = flacAst();
      const flac = extension === "flac" ? bytes : Buffer.from(oggAst().parse(bytes).tracks[0]!.samples[0]!.data);
      const doc = plugin.parse(flac, { decodeAudio: true });
      const assignment = { indep: 1, left_side: 8, right_side: 9, mid_side: 10 }[mode];
      assert.ok(doc.tracks[0]!.samples.length > 1);
      for (const packet of doc.tracks[0]!.samples) assert.equal(packet.data[3]! >>> 4, assignment);
      const wav = wavAst().serialize(doc, { audioCodec: "pcm_s16le" });
      const decoded = wavAst().parse(wav, { decodeAudio: true }).tracks.find(track => track.type === "audio")!.decodedAudio!;
      assert.equal(decoded.channelData[0]!.length, 4096);
      for (let i = 0; i < 4096; i++) for (let channel = 0; channel < 2; channel++) {
        assert.equal(Math.round(decoded.channelData[channel]![i]! * 32768), pcm.readInt16LE(i * 4 + channel * 2));
      }
    }
  });
}
