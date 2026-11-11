import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg fixtures: stereo 16000 Hz, 16384 samples, each sample is
// (i * 997 + channel * 17111) % 2**(bits - 1) - 2**(bits - 2).
for (const bits of [16, 24]) for (const sync of [false, true]) {
  for (const mode of ["trim", "duration-copy", "frame-copy"]) {
    it(`${mode} FLAC ${bits}-bit (${sync ? "sync" : "async"})`, async () => {
      const input = readFileSync(new URL(`./fixtures/trim-${bits}.flac`, import.meta.url));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.flac", input);
      const options = mode === "trim" ? ["-ss", "0.1", "-t", "0.4"]
        : ["-c", "copy", ...(mode === "frame-copy" ? ["-frames:a", "1"] : ["-t", "0.4"])];
      const args = ["-v", "error", "-y", "-i", "/in.flac", ...options, "/out.flac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), mode === "trim" ? undefined : "");
      }
      // Decoded PCM trimming defers to the async path for frame timestamp handling.
      if (!sync || mode === "trim") {
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
      const output = volume.readFileSync("/out.flac") as Buffer;
      if (mode === "trim") {
        const decoded = flacAst().parse(output).tracks[0]!.decodedAudio!;
        const pcm = Buffer.alloc(decoded.channelData[0]!.length * decoded.channels * bits / 8);
        for (let i = 0; i < decoded.channelData[0]!.length; i++) for (let channel = 0; channel < decoded.channels; channel++) {
          pcm.writeIntLE(decoded.channelData[channel]![i]! * 2 ** (bits - 1), (i * decoded.channels + channel) * bits / 8, bits / 8);
        }
        assert.deepEqual(output.subarray(26, 42), createHash("md5").update(pcm).digest());
      }
      const source = flacAst().probe(input, { showPackets: true }).packets!;
      const packets = flacAst().probe(output, { showPackets: true }).packets!;
      const selected = mode === "frame-copy" ? source.slice(0, 1) : source.filter(p => Number(p.pts) < 6400);
      const count = mode === "trim" ? 6400 : selected.reduce((n, p) => n + Number(p.duration), 0);
      assert.equal(packets.reduce((n, p) => n + Number(p.duration), 0), count);
      if (mode !== "trim") {
        assert.equal(packets.length, selected.length);
        packets.forEach((packet, i) => assert.deepEqual(
          output.subarray(Number(packet.pos), Number(packet.pos) + Number(packet.size)),
          input.subarray(Number(selected[i]!.pos), Number(selected[i]!.pos) + Number(selected[i]!.size))));
      }
      const doc = flacAst().parse(output);
      assert.equal(doc.tracks[0]!.codecDescriptions[0]!.bitsPerSample, bits);
      const audio = doc.tracks[0]!.decodedAudio!;
      assert.ok(audio);
      for (let channel = 0; channel < 2; channel++) for (let i = 0; i < count; i++) {
        const sample = ((i + (mode === "trim" ? 1600 : 0)) * 997 + channel * 17111) % 2 ** (bits - 1) - 2 ** (bits - 2);
        assert.equal(audio.channelData[channel]![i], sample / 2 ** (bits - 1));
      }
    });
  }
}

it("keeps FLAC input immutable and enforces decoding memory limits", () => {
  const input = readFileSync(new URL("./fixtures/trim-24.flac", import.meta.url));
  const original = Buffer.from(input);
  assert.throws(() => flacAst().parse(input, { limits: { maxMemoryBytes: 1 } }), /maxMemoryBytes/);
  const doc = flacAst().parse(input, { decodeAudio: false, limits: { maxMemoryBytes: 1 } });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.ok(doc.tracks[0]!.samples.length > 1);
  assert.deepEqual(input, original);
});
