import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, -4000, 8000];
const right = [12000, 13000, -14000, -16000];
function pcm(samples: readonly number[]) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
}

// Native FFmpeg 7.0.2 and 9.0.1: center contributes to both speakers; LFE is omitted.
for (const layout of ["FC+LFE", "DL+DR", "downmix", "stereo", "FL+LFE"]) {
  for (const speaker of ["FL", "FR"]) {
    for (const mode of ["simple", "graph", "merge", "explicit", "disabled"]) {
      it(`channelsplit remixes ${layout} to ${speaker} (${mode})`, async () => {
        const volume = Volume.fromJSON({
          "/in.raw": pcm(left.flatMap((sample, index) => [sample, right[index]!])),
          "/left.raw": pcm(left), "/right.raw": pcm(right)
        });
        const names = layout === "downmix" ? ["DL", "DR"] : layout === "stereo" ? ["FL", "FR"] : layout.split("+");
        const input = (path: string, channels: string) => ["-f", "s16le", "-ar", "1000", "-channel_layout", channels, "-i", path];
        const split = `${mode === "explicit" ? "aformat=channel_layouts=stereo," : ""}channelsplit=stereo:${speaker}`;
        let stderr = "";
        const stdout: Buffer[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(mode === "disabled" ? ["-noauto_conversion_filters"] : []),
            ...(mode === "merge" ? [...input("/left.raw", names[0]!), ...input("/right.raw", names[1]!)] : input("/in.raw", layout)),
            ...(mode === "merge" || mode === "graph"
              ? ["-filter_complex", `${mode === "merge" ? "[0:a][1:a]amerge," : "[0:a]"}${split}[out]`, "-map", "[out]"]
              : ["-af", split]), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (layout === "FL+LFE" || mode === "disabled" && layout !== "stereo") {
          assert.notEqual(result.exitCode, 0);
          assert.equal(Buffer.concat(stdout).length, 0);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(Buffer.concat(stdout), pcm(layout === "FC+LFE" ? [707, 1414, -2828, 5657] : speaker === "FL" ? left : right));
        }
      });
    }
  }
}
