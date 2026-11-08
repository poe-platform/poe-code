import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [language, packed] of [
  ["French", 0x7fff], ["Fra", 0x7fff], ["french", 0x1a45], ["deu", 0x10b5], ["", 0x55c4]
] as const) {
  it(`copies audio with native MP4 language encoding for ${JSON.stringify(language)}`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true }));
    const audio = base.tracks.find(track => track.type === "audio")!;
    const input = serializeMp4({ ...base, metadata: { title: "Meeting" }, tracks: [
      { ...audio, id: 1, language: "eng" }, { ...audio, id: 2, language: "fra" }
    ] });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp4", input);
    const args = ["-y", "-i", "/in.mp4", "-map", "0:a", "-c", "copy", "-metadata:s:a:1", `language=${language}`, "/out.mp4"];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = volume.readFileSync("/out.mp4") as Buffer;
    const first = output.indexOf("mdhd");
    const second = output.indexOf("mdhd", first + 4);
    assert.ok(first >= 0 && second > first);
    // Version-zero mdhd language field: native FFmpeg uses 0x7fff for invalid input.
    assert.equal(output.readUInt16BE(first + 24), 0x15c7);
    assert.equal(output.readUInt16BE(second + 24), packed);
    const parsed = parseMp4(new Uint8Array(output));
    assert.equal(parsed.metadata.title, "Meeting");
    assert.deepEqual(parsed.tracks.map(track => track.samples.map(sample => sample.data)),
      parseMp4(input).tracks.map(track => track.samples.map(sample => sample.data)));
  });
}
