import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independent Python wave input and native FFmpeg CAF output.
const wav = Buffer.from("524946463600000057415645666d74201000000001000100401f0000803e00000200100064617461120000000080ffbffffeffff0000010001010140ff7f", "hex");
const caf = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f000000000000001900000001656e636f646572004c61766636332e312e31303100646174610000000000000016000000008000bffffeffffff00000001010140017fff", "hex");

for (const direction of ["encode", "decode"]) {
  for (const sync of [false, true]) {
    it(`supports CAF ${direction} (${sync ? "sync" : "async"})`, async () => {
      const input = direction === "encode" ? wav : caf;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.bin", input);
      const args = ["-v", "error", "-y", "-i", "/in.bin", "-f", direction === "encode" ? "caf" : "s16le", "/out.bin"];
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.bin") as Buffer;
      if (direction === "encode") {
        assert.equal(output.toString("ascii", 0, 4), "caff");
        assert.equal(output.readDoubleBE(20), 8000);
        assert.equal(output.toString("ascii", 28, 32), "lpcm");
        assert.equal(output.readUInt32BE(32), 0);
        assert.equal(output.readUInt32BE(44), 1);
        assert.equal(output.readUInt32BE(48), 16);
        let offset = 8;
        while (output.toString("ascii", offset, offset + 4) !== "data") {
          offset += 12 + Number(output.readBigInt64BE(offset + 4));
        }
        assert.deepEqual(output.subarray(offset + 16), caf.subarray(caf.length - 18));
      } else assert.deepEqual(output, wav.subarray(44));
    });
  }
}

// FFmpeg-generated CAF with title=Needle, artist=Tester and five PCM16 samples.
const taggedCaf = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f0000000000000034000000037469746c65004e6565646c65006172746973740054657374657200656e636f646572004c61766636332e312e3130310064617461000000000000000e000000008000feff000001017fff", "hex");

for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    it(`preserves CAF title, artist and PCM on ${copy ? "copy" : "write"} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.caf", taggedCaf);
      const args = ["-v", "error", "-y", "-i", "/in.caf",
        ...(copy ? ["-c:a", "copy"] : ["-metadata", "title=New title", "-metadata", "artist=New artist", "-c:a", "pcm_s16be"]), "/out.caf"];
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.caf") as Buffer;
      const tags: Record<string, string> = {};
      let pcm: Buffer | undefined;
      for (let offset = 8; offset < output.length;) {
        const id = output.toString("ascii", offset, offset + 4);
        const size = Number(output.readBigInt64BE(offset + 4));
        const start = offset + 12;
        if (id === "info") {
          const strings = output.toString("utf8", start + 4, start + size).split("\0");
          for (let i = 0; i < output.readUInt32BE(start); i++) tags[strings[i * 2]!] = strings[i * 2 + 1]!;
        }
        if (id === "data") pcm = output.subarray(start + 4, start + size);
        offset = start + size;
      }
      assert.equal(tags.title, copy ? "Needle" : "New title");
      assert.equal(tags.artist, copy ? "Tester" : "New artist");
      assert.deepEqual(pcm, Buffer.from("8000feff000001017fff", "hex"));
    });
  }
}
