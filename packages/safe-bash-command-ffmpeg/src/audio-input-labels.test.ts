import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { wavAst, allMediaAsts, createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const mixed of [false, true]) {
  for (const label of ["1", "1:0", "1:1", "1:a", "1:a:0", "1:3", "1:a:3", "2", "1:v", "1:0:0", "1:", "1:a:", "-1", "1:-1", "1:0.0"]) {
    for (const split of [false, true]) {
      it(`resolves audio input [${label}] with ${split ? "channelsplit" : "areverse"} (${mixed ? "video then audio" : "audio only"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        for (const [index, file] of ["a", "b"].entries()) {
          volume.writeFileSync(`/${file}.wav`, encodeWav({ sampleRate: 8000,
            channels: [1, -1].map((sign, channel) => Float64Array.from({ length: 8 },
              (_, frame) => sign * (500 + index * 1000 + channel * 100 + frame * 10) / 32768)) }));
        }
        let stderr = "";
        // A typed control branch identifies mixed-input graphs as audio graphs.
      const wav = wavAst();
        const result = await createFfmpegCommand({ asts: mixed ? [{ ...wav, parse(bytes, options) {
          const doc = wav.parse(bytes, options);
          const video = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 })).tracks[0]!;
          return { ...doc, tracks: [video, ...doc.tracks] };
        } }, ...allMediaAsts().filter(ast => ast.id !== wav.id)] : undefined }).execute({
          args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
            `[${label}]${split ? "channelsplit=stereo:FR," : ""}areverse[out]${mixed ? ";[0:a]anull[control]" : ""}`,
            "-map", "[out]", ...(mixed ? ["-map", "[control]"] : []),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (["1", mixed ? "1:1" : "1:0", "1:a", "1:a:0"].includes(label)) {
          assert.equal(result.exitCode, 0, stderr);
          const expected = Array.from({ length: 8 }, (_, i) => 7 - i)
            .flatMap(i => split ? [-1600 - i * 10] : [1500 + i * 10, -1600 - i * 10]);
          assert.equal(output.length, expected.length * 2);
          assert.deepEqual(expected.map((_, i) => output.readInt16LE(i * 2)), expected);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes(`Invalid audio filter input: ${label}`), stderr);
          assert.equal(output.toString(), "keep");
        }
      });
    }
  }
}
