import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: false });
const source = parseMp4(input).tracks[0]!;
const sourceFrames = [...decodeH264Samples(source.samples, source.codecDescriptions, 16, 16, source.timescale)];

for (const flag of ["-frames:v", "-vframes"]) {
  for (const [operand, count] of [["2", 2], ["1e1", 5], ["0x2", 2], ["0.002k", 2]] as const) {
    it(`${flag} ${operand} preserves the complete integer and copied frames`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.mp4", input);
      const args = ["-v", "error", "-i", "/in.mp4", "-c:v", "copy", flag, operand, "/out.mp4"];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      assert.equal(output.samples.length, count);
      assert.deepEqual(output.samples.map(sample => [...sample.data]), source.samples.slice(0, count).map(sample => [...sample.data]));
      const frames = [...decodeH264Samples(output.samples, output.codecDescriptions, 16, 16, output.timescale)];
      assert.equal(frames.length, count);
      assert.deepEqual(frames.map(frame => frame.data), sourceFrames.slice(0, count).map(frame => frame.data));
    });
  }
}
