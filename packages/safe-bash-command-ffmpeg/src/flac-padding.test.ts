import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Fixtures: native FFmpeg FLAC with title=Meeting, artist=Alice and the PCM below.
for (const bits of [16, 24]) for (const sync of [false, true]) {
  for (const mode of ["encode", "preserve"]) for (const padding of [0, 1, 512, -1]) {
    it(`FLAC padding ${padding} ${mode}, ${bits}-bit (${sync ? "sync" : "async"})`, async () => {
      const audio = { sampleRate: 16000, channels: 2,
        channelData: Array.from({ length: 2 }, (_, channel) => Float64Array.from({ length: 256 },
          (_, i) => ((i * 997 + channel * 17111) % 2 ** (bits - 1) - 2 ** (bits - 2)) / 2 ** (bits - 1))) };
      const input = mode === "encode" ? encodeWav({ channels: audio.channelData, sampleRate: audio.sampleRate }, { bitsPerSample: bits as 16 | 24 })
        : readFileSync(new URL(`./fixtures/metadata-${bits}.flac`, import.meta.url));
      const path = mode === "encode" ? "/in.wav" : "/in.flac";
      const volume = Volume.fromJSON({});
      volume.writeFileSync(path, input);
      const options = mode === "preserve" ? [] : ["-metadata", "title=Réview"];
      const args = ["-v", "error", "-y", "-i", path, "-c:a", mode === "encode" ? "flac" : "copy", ...options, "-metadata_header_padding", String(padding), "/out.flac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.flac") as Buffer;
      if (mode === "encode") {
        const decoded = flacAst().parse(output).tracks[0]!.decodedAudio!;
        const pcm = Buffer.alloc(decoded.channelData[0]!.length * decoded.channels * bits / 8);
        for (let i = 0; i < decoded.channelData[0]!.length; i++) for (let channel = 0; channel < decoded.channels; channel++) {
          pcm.writeIntLE(decoded.channelData[channel]![i]! * 2 ** (bits - 1), (i * decoded.channels + channel) * bits / 8, bits / 8);
        }
        assert.deepEqual(output.subarray(26, 42), createHash("md5").update(pcm).digest());
      }
      const parsed = parseAudio(output);
      const blocks = parsed.nodes.filter(node => node.type === "PADDING");
      assert.deepEqual(blocks.map(node => node.data.length), padding === 0 ? [] : [padding === -1 ? 8192 : padding]);
      for (const block of blocks) assert.ok(block.data.every(byte => byte === 0));
      assert.equal(parsed.tags.title, mode === "preserve" ? "Meeting" : "Réview");
      assert.equal(parsed.tags.artist, mode === "encode" ? undefined : "Alice");
      if (mode !== "encode") assert.deepEqual(Array.from(parsed.nodes.find(node => node.type === "FRAMES")!.data),
        Array.from(parseAudio(input).nodes.find(node => node.type === "FRAMES")!.data));
      const decoded = flacAst().parse(output).tracks[0]!.decodedAudio!;
      assert.deepEqual(decoded.channelData.map(data => Array.from(data)), audio.channelData.map(data => Array.from(data)));
    });
  }
}

it("caps FLAC padding to the metadata block limit", () => {
  const plugin = flacAst();
  const input = readFileSync(new URL("./fixtures/metadata-16.flac", import.meta.url));
  const doc = plugin.parse(input, { decodeAudio: false });
  const output = plugin.serialize(doc, { audioCodec: "copy", metadataHeaderPadding: 2147483647 });
  assert.deepEqual(parseAudio(output).nodes.filter(node => node.type === "PADDING").map(node => node.data.length), [0xffffff]);
});

for (const value of ["-2", "2147483648", "1.5", "oops", ""]) {
  it(`rejects invalid FLAC padding ${JSON.stringify(value)} without output`, async () => {
    let written = false;
    let stderr = "";
    const args = ["-i", "/in.flac", "-c", "copy", "-metadata_header_padding", value, "/out.flac"];
    assert.equal(evalSyncFfmpeg(args, undefined, () => undefined, () => { written = true; return true; }), undefined);
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { written = true; } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.match(stderr, /invalid metadata_header_padding/);
    assert.equal(written, false);
  });
}
