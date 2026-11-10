import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [layout, map, expected] of [
  ["FR+FL", "0.0-FL|1.1-FR", [4000, 1000]],
  ["FL+FR", "0.0-FL|1.1-FR", [1000, 4000]],
  ["stereo", "1.1-FR|0.0-FL", [1000, 4000]],
  ["FR+FL", "1.FR-FR|0.FL-FL", [4000, 1000]],
  ["FR+FL", "", [2000, 1000]],
  ["BR+FL+FR+BL", "0.0-FL|0.1-FR|1.0-BL|1.1-BR", [4000, 1000, 2000, 3000]]
] as const) {
  it(`interleaves raw join output in requested channel order: ${layout}:${map}`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const [index, samples] of [[1000, 2000], [3000, 4000]].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: samples.map(sample => new Float64Array(512).fill(sample / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        `[0:a][1:a]join=channel_layout=${layout}${map ? `:map=${map}` : ""}[o]`,
        "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
    const bytes = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(bytes.length, 512 * expected.length * 2);
    for (let frame = 0; frame < 512; frame++) {
      assert.deepEqual(expected.map((_, channel) => bytes.readInt16LE((frame * expected.length + channel) * 2)),
        expected, `frame ${frame}`);
    }
  });
}
