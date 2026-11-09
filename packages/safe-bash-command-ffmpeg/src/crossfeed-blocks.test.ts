import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 PCM16 hashes for impulses around block boundaries.
// Short inputs use zero padding: native reads beyond its input buffer and can
// otherwise produce silence or NaNs depending on allocation/argument spelling.
const cases = [
  [1100, "asendcmd=c='0.064 crossfeed level_out 0',crossfeed=block_size=256", "5d751eb062471bf9f3f76707ce225ce9202e60bad7b3400c32bb88c60c5d67e6"],
  [1024, "crossfeed=block_size=256:enable=0", "d637473e343032ddc1161161065b16fa4da2a9566dbf9dd2fd4b439bc119a865"],
  [1100, "crossfeed=block_size=256:enable='gte(t,0.064)'", "4b39310f570c8984eebc4e093fb68bd080f164dbc28dd82029cc4d2116e5fe47"],
  [1100, "asetpts=PTS+8000,crossfeed=block_size=256", "0e1ee4dddc191450106bc6a67944f6f2658fb6ca6844e202a910a30a396a6e00"],
  [1100, "crossfeed", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
  [1100, "crossfeed=block_size=0", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
  [1100, "crossfeed=block_size=0.5", "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2"],
  [1100, "crossfeed=block_size=1.5", "dced2dc4d55309bb1b0334ba1cce54827944250f6750415390053d33bf19fb78"],
  [9, "crossfeed=0.2:0.5:0.5:0.9:1:256", "67d4f1c20506e87ac9d4c3975c9b960ddb71560e2bc456eaca7b71ba1c90cee7"],
  [1100, "crossfeed=block_size=256", "0e1ee4dddc191450106bc6a67944f6f2658fb6ca6844e202a910a30a396a6e00"],
  [1100, "crossfeed=0.2:0.5:0.5:0.9:1:256", "0e1ee4dddc191450106bc6a67944f6f2658fb6ca6844e202a910a30a396a6e00"],
  [1100, "crossfeed=block_size=1", "c2c6d477388304407d2898e79bd4f88dd3dd18a195f0fe68a51d2b66787436ec"],
  [1100, "crossfeed=block_size=32", "0e1ee4dddc191450106bc6a67944f6f2658fb6ca6844e202a910a30a396a6e00"],
  [1024, "crossfeed=block_size=256", "2f41d5c2f9409376a0595ff9de247a28f3d4936abd6730fea6838101c821d1cc"],
  [256, "crossfeed=block_size=256", "1006392da12e48ef7ab9028426c3d4062fde93d55e35c9d61c02c92ac779a6d8"],
  [257, "crossfeed=block_size=256", "a3936d4288c1bfe7c446338c9bdf2e9202daf3af8e7f0b3bd3d6faa1c2b6f50f"],
  [9, "crossfeed=block_size=256", "67d4f1c20506e87ac9d4c3975c9b960ddb71560e2bc456eaca7b71ba1c90cee7"],
  [32769, "crossfeed=block_size=32768", "b9809b937e49f6b9351c06644fecfd9365125649792734485ddb95be5be443ad"]
] as const;

for (const complex of [false, true]) {
  for (const [length, filter, digest] of cases) {
    it(`crossfeed blocks ${complex ? "graph" : "simple"}: ${length} samples, ${filter}`, async () => {
      const channels = [new Float64Array(length), new Float64Array(length)];
      for (const frame of [0, 510, 512, 1022, 1024]) if (frame < length) channels[0]![frame] = 15000 / 32768;
      for (const frame of [3, 515, 1027]) if (frame < length) channels[1]![frame] = -8000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter},ashowinfo[s]`, "-map", "[s]"]
          : ["-af", `${filter},ashowinfo`]), "-c:a", "pcm_s16le", "/out.wav"],
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
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData[0]!.length, length);
      assert.equal(audio.channelData[1]!.length, length);
      const pcm = Buffer.alloc(length * 4);
      for (let i = 0; i < length; i++) {
        for (let c = 0; c < 2; c++) pcm.writeInt16LE(audio.channelData[c]![i]! * 32768, i * 4 + c * 2);
      }
      assert.equal(createHash("sha256").update(pcm).digest("hex"), digest);
      if (length === 1100 && filter.endsWith("256") && !filter.startsWith("asendcmd")) {
        assert.equal(pcm.readInt16LE(509 * 4), -1260);
        assert.equal(pcm.readInt16LE(509 * 4 + 2), 1260);
        const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
        assert.deepEqual(frames.map(line => Number(line.split("nb_samples:")[1]!.split(" ")[0])), [0, 256, 256, 256, 256, 76]);
        assert.deepEqual(frames.map(line => Number(line.split(" pts:")[1]!.split(" ")[0])), [0, ...[0, 256, 512, 768, 1024].map(pts => pts + (filter.startsWith("asetpts") ? 8000 : 0))]);
        assert.ok(frames.every(line => line.includes("fmt:dbl ")));
      }
    });
  }
}

it("accounts for crossfeed block buffers before allocating them", async () => {
  for (const blockSize of [0, 32768]) {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(9), new Float64Array(9)] }));
    volume.writeFileSync("/out.wav", "KEEP");
    let stderr = "";
    const result = await createFfmpegCommand({ limits: { maxMemoryBytes: 65536 } }).execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", "-af", `crossfeed=block_size=${blockSize}`, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (blockSize === 0) assert.equal(result.exitCode, 0, stderr);
    else {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("maxMemoryBytes"), stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
    }
  }
});
