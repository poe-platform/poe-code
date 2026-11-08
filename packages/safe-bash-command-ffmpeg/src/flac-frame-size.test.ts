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

for (const sync of [false, true]) for (const size of [256, 1024, 1000, 0, 16, 65535, 1, 15, 65536, -1, 1.5]) {
  it(`${sync ? "sync" : "async"} FLAC frame_size ${size} controls real packets and preserves PCM`, async () => {
    const valid = size === 0 || Number.isInteger(size) && size >= 16 && size <= 65535;
    for (const extension of ["flac", "ogg"]) {
      const volume = Volume.fromJSON({ "/in.pcm": pcm });
      const args = ["-y", "-f", "s16le", "-ar", "16000", "-ac", "2", "-i", "/in.pcm",
        "-c:a", "flac", "-frame_size", String(size), `/out.${extension}`];
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
      const blockSize = size || 2048;
      const expected = Array.from({ length: Math.ceil(4096 / blockSize) }, (_, i) => Math.min(blockSize, 4096 - i * blockSize));
      assert.equal(flac.readUInt16BE(8), blockSize);
      assert.equal(flac.readUInt16BE(10), blockSize);
      assert.equal(flac.readBigUInt64BE(18) & 0xfffffffffn, 4096n);
      const probe = plugin.probe(flac, { showPackets: true });
      assert.deepEqual(probe.packets!.map(packet => packet.duration), expected);
      const wav = wavAst().serialize(doc, { audioCodec: "pcm_s16le" });
      const decoded = wavAst().parse(wav, { decodeAudio: true }).tracks.find(track => track.type === "audio")!.decodedAudio!;
      assert.equal(decoded.channelData[0]!.length, 4096);
      for (let i = 0; i < 4096; i++) for (let channel = 0; channel < 2; channel++) {
        assert.equal(Math.round(decoded.channelData[channel]![i]! * 32768), pcm.readInt16LE(i * 4 + channel * 2));
      }
    }
  });
}
