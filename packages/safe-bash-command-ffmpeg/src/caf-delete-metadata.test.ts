import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg WAV: artist=Original and PCM16 samples [100, -200, 300, -400].
const input = Buffer.from("524946466000000057415645666d74201000000001000100401f0000803e0000020010004c4953542c000000494e464f49415254090000004f726967696e616c0000495346540d0000004c61766636332e312e31303100006461746108000000640038ff2c0170fe", "hex");

for (const sync of [false, true]) {
  for (const artist of [undefined, "", "New"]) {
    it(`writes CAF artist ${JSON.stringify(artist)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input });
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16be",
        ...(artist === undefined ? [] : ["-metadata", `artist=${artist}`]), "-f", "caf", sync ? "/out.caf" : "pipe:1"];
      const chunks: Uint8Array[] = [];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = sync ? volume.readFileSync("/out.caf") as Buffer : Buffer.concat(chunks);
      const tags: Record<string, string> = {};
      let pcm: Buffer | undefined;
      for (let offset = 8; offset < output.length;) {
        const id = output.toString("ascii", offset, offset + 4);
        const size = Number(output.readBigInt64BE(offset + 4));
        const start = offset + 12;
        const end = size === -1 ? output.length : start + size;
        if (id === "info") {
          const strings = output.toString("utf8", start + 4, end).split("\0");
          for (let i = 0; i < output.readUInt32BE(start); i++) tags[strings[i * 2]!] = strings[i * 2 + 1]!;
        }
        if (id === "data") pcm = output.subarray(start + 4, end);
        offset = end;
      }
      if (artist === "") assert.equal(Object.hasOwn(tags, "artist"), false);
      else assert.equal(tags.artist, artist ?? "Original");
      assert.deepEqual(pcm, Buffer.from("0064ff38012cfe70", "hex"));
    });
  }
}
