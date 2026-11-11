import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mask of [0x30, 5]) for (const mode of ["mono", "stereo", "surround", "extrastereo", "graph", "anull"]) {
  for (const existing of [false, true]) {
    it(`handles unsupported input mask ${mask}, ${mode}, existing=${existing}`, async () => {
      const input = Buffer.alloc(76);
      input.write("RIFF", 0);
      input.writeUInt32LE(68, 4);
      input.write("WAVEfmt ", 8);
      input.writeUInt32LE(40, 16);
      input.writeUInt16LE(0xfffe, 20);
      input.writeUInt16LE(2, 22);
      input.writeUInt32LE(8000, 24);
      input.writeUInt32LE(32000, 28);
      input.writeUInt16LE(4, 32);
      input.writeUInt16LE(16, 34);
      input.writeUInt16LE(22, 36);
      input.writeUInt16LE(16, 38);
      input.writeUInt32LE(mask, 40);
      input.set(Buffer.from("0100000000001000800000aa00389b71", "hex"), 44);
      input.write("data", 60);
      input.writeUInt32LE(8, 64);
      input.writeInt16LE(12000, 68);
      input.writeInt16LE(12000, 74);
      const volume = Volume.fromJSON(existing ? { "/out.wav": "existing" } : {});
      volume.writeFileSync("/in.wav", input);
      const options = mode === "mono" ? ["-ac", "1"] : mode === "stereo" ? ["-ac", "2"]
        : mode === "surround" ? ["-ac", "6"] : mode === "graph"
          ? ["-filter_complex", "[0:a]extrastereo=m=1[s]", "-map", "[s]"]
          : ["-af", mode === "anull" ? "anull" : "extrastereo=m=1"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...options, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (mode === "anull") {
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channelMask, mask);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), [[12000, 0], [0, 12000]]);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.match(stderr, /unsupported.*channel layout/i);
        if (mode === "extrastereo" || mode === "graph") {
          // Native FFmpeg opens the output before stereo negotiation fails.
          assert.equal(result.exitCode, 234);
          assert.equal(volume.readFileSync("/out.wav").length, 0);
        } else if (existing) assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
        else assert.equal(volume.existsSync("/out.wav"), false);
      }
    });
  }
}
