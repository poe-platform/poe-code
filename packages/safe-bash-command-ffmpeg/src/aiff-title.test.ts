import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.from("0080fffe00000101ff7f", "hex");
// Native FFmpeg PCM16BE AIFF with title=Needle.
const tagged = Buffer.from("464f524d00000046414946464e414d45000000064e6565646c65434f4d4d000000120001000000050010400bfa0000000000000053534e440000001200000000000000008000feff000001017fff", "hex");
for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    it(`${sync ? "sync" : "async"} AIFF title survives ${copy ? "stream copy" : "explicit metadata"}`, async () => {
      const volume = Volume.fromJSON({});
      const input = copy ? "/in.aiff" : "/in.wav";
      volume.writeFileSync(input, copy ? tagged : encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([-32768, -257, 0, 257, 32767], value => value / 32768)] }));
      const args = ["-y", "-v", "error", "-i", input,
        ...(copy ? ["-c:a", "copy"] : ["-metadata", "title=Needle", "-metadata", "artist=Tester", "-c:a", "pcm_s16be"]), "/out.aiff"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
          (name, bytes) => { volume.writeFileSync(name, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(name: string) { return volume.readFileSync(name); },
            async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
            async stat(name: string) { return volume.statSync(name); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = volume.readFileSync("/out.aiff") as Buffer;
      let title: string | undefined;
      let sound: Buffer | undefined;
      for (let offset = 12; offset < bytes.length;) {
        const size = bytes.readUInt32BE(offset + 4);
        const id = bytes.toString("ascii", offset, offset + 4);
        if (id === "NAME") title = bytes.toString("utf8", offset + 8, offset + 8 + size);
        if (id === "SSND") sound = Buffer.from(bytes.subarray(offset + 16, offset + 8 + size)).swap16();
        offset += 8 + size + size % 2;
      }
      assert.equal(title, "Needle");
      assert.deepEqual(sound, pcm);
      assert.deepEqual(bytes, tagged);
    });
  }
}
