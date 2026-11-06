import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const separator of ["", "# marker\n", "\n", "  \n  # marker\n\n"]) {
  for (const [directives, start, end] of [
    [["inpoint 0.25"], 2000, 8000],
    [["outpoint 0.75"], 0, 6000],
    [["duration 0.5"], 0, 8000],
    [["inpoint 0.25", "outpoint 0.75"], 2000, 6000]
  ] as const) {
    it(`concat preserves ${directives.join(", ")} across ${JSON.stringify(separator)}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile 'with space.wav'\n${separator}${directives.join(`\n${separator}`)}\n${separator}file b.wav\n`
      });
      for (const [name, base] of [["with space.wav", 1000], ["b.wav", -9000]] as const) {
        volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
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
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channelData[0]!.length, end - start + 8000);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), [
        ...Array.from({ length: end - start }, (_, i) => 1000 + start + i),
        ...Array.from({ length: 8000 }, (_, i) => -9000 + i)
      ]);
    });
  }
}
