import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: stereo program, separate PCM16 impulse responses at 8000 Hz.
for (const [layout, hash] of [
  ["mono", "3ce911f3922e6ac39ce0cbdcf3d77dc93f8573d4bcec0605f746f372fd6eb565"],
  ["quad", "4ca9a2e563bdf74ec8f9f379650c51e732198005eb12d292601ea897b53eb203"],
  ["stereo", "c8cab7e248ff92cc2e2421658a896f91e6cc2564ebb4c5422f5a644a0e5dddc2"]
]) {
  for (const explicit of [false, true]) {
    it(`headphone remixes ${layout} responses with ${explicit ? "explicit" : "automatic"} conversion`, async () => {
      const volume = Volume.fromJSON({});
      for (let input = 0; input < 3; input++) {
        const count = input === 0 ? 240 : 16;
        const bytes = Buffer.alloc(count * 2);
        for (let i = 0; i < count; i++) {
          bytes.writeInt16LE(input === 0 ? i * 437 % 8001 - 4000
            : i === input ? 8192 : i === input + 1 ? 4096 : 0, i * 2);
        }
        volume.writeFileSync(`/${input}.raw`, bytes);
      }
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...["stereo", layout, "stereo"].flatMap((channels, input) =>
          ["-f", "s16le", "-ar", "8000", "-ch_layout", channels, "-i", `/${input}.raw`]),
        "-filter_complex", explicit
          ? "[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo[ir];[0:a][ir][2:a]headphone=map=FL|FR:type=time[o]"
          : "[0:a][1:a][2:a]headphone=map=FL|FR:type=time[o]",
        "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).toString(), "");
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, 480);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }
}
