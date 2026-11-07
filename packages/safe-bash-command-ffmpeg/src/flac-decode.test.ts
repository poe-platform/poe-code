import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// SHA-256 of native FFmpeg's -f s16le / -f s24le output for these fixtures.
const hashes = {
  16: ["ce4238fccbeaf7bc046398f828abe32d10f99f89ab1c5a4323bab3255ee6707c", "fb0817f35602004b8a8c31043b4b02086de7890d1e44399fea4a0068643cd009"],
  24: ["7a24e5363b049f5357c9df60997fa579b80d860a1627242e2f9436e16e4153fb", "4f184afa5b70b072254777cd0226225dbe76612d7298c23ce320a95b11b616f9"]
};

for (const bits of [16, 24] as const) for (const sync of [false, true]) {
  for (const mode of ["wav", "wav24", "volume", "mono", "resample"]) {
    it(`decodes ${bits}-bit FLAC for ${mode} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.flac", readFileSync(new URL(`./fixtures/trim-${bits}.flac`, import.meta.url)));
      const channels = Array.from({ length: 2 }, (_, channel) => Float64Array.from({ length: 16384 },
        (_, i) => ((i * 997 + channel * 17111) % 2 ** (bits - 1) - 2 ** (bits - 2)) / 2 ** (bits - 1)));
      volume.writeFileSync("/in.wav", encodeWav({ channels, sampleRate: 16000 }, { bitsPerSample: bits }));
      const wav = mode === "wav" || mode === "wav24";
      const options = mode === "wav24" ? ["-c:a", "pcm_s24le"]
        : mode === "volume" ? ["-af", "volume=0"]
        : mode === "mono" ? ["-ac", "1"] : mode === "resample" ? ["-ar", "8000"] : [];
      for (const source of wav ? ["flac"] : ["flac", "wav"]) {
        const output = `/${source}-out.${wav ? "wav" : "flac"}`;
        const args = ["-v", "error", "-y", "-i", `/in.${source}`, ...options, output];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), wav ? "" : undefined);
          if (!wav) assert.equal(volume.existsSync(output), false);
        }
        if (!sync || !wav) {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: { async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); } },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
      }
      if (wav) {
        const parsed = parseAudio(volume.readFileSync("/flac-out.wav") as Buffer);
        const pcm = parsed.nodes.find(node => node.type === "data")!.data;
        assert.equal(pcm.length, 16384 * 2 * (mode === "wav24" ? 3 : 2));
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hashes[bits][mode === "wav24" ? 1 : 0]);
      } else {
        const audio = flacAst().parse(volume.readFileSync("/flac-out.flac") as Buffer).tracks[0]!.decodedAudio!;
        const control = flacAst().parse(volume.readFileSync("/wav-out.flac") as Buffer).tracks[0]!.decodedAudio!;
        assert.deepEqual(audio, control);
        assert.equal(audio.channels, mode === "mono" ? 1 : 2);
        assert.equal(audio.sampleRate, mode === "resample" ? 8000 : 16000);
        assert.equal(audio.channelData[0]!.length, mode === "resample" ? 8192 : 16384);
        if (mode === "volume") assert.ok(audio.channelData.every(channel => channel.every(sample => sample === 0)));
      }
    });
  }
}
