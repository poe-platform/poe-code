import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independent PCM16 WAV: mono, 8 kHz, [-32768, -257, 0, 257, 32767].
const wav = Buffer.from("524946462e00000057415645666d74201000000001000100401f0000803e000002001000646174610a0000000080fffe00000101ff7f", "hex");

for (const [codec, tag, payload] of [
  ["pcm_mulaw", "ulaw", "0067ffe780"],
  ["pcm_alaw", "alaw", "2a45d5c5aa"]
] as const) {
  for (const sync of [false, true]) {
    it(`writes CAF ${codec} with native G.711 bytes (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", wav);
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-metadata", "title=Needle",
        "-metadata", "artist=Tester", "-c:a", codec, "/out.caf"];
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
      assert.equal(output.toString("ascii", 0, 4), "caff");
      assert.equal(output.readDoubleBE(20), 8000);
      assert.equal(output.toString("ascii", 28, 32), tag);
      assert.equal(output.readUInt32BE(32), 0);
      assert.equal(output.readUInt32BE(36), 1);
      assert.equal(output.readUInt32BE(40), 1);
      assert.equal(output.readUInt32BE(44), 1);
      assert.equal(output.readUInt32BE(48), 8);
      let data: Buffer | undefined;
      for (let offset = 8; offset < output.length;) {
        const size = Number(output.readBigInt64BE(offset + 4));
        if (output.toString("ascii", offset, offset + 4) === "data") {
          data = output.subarray(offset + 16, offset + 12 + size);
        }
        offset += 12 + size;
      }
      assert.deepEqual(data, Buffer.from(payload, "hex"));
    });
  }
}
