import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from("1414141414141414141414181414141814141418fa000018", "hex");
// FFmpeg 7.0.2 reports each boundary before printing that frame's metadata.
const boundaries = [
  ["freeze_start: 0", "freeze_duration: 0.5", "freeze_end: 0.5"],
  ["freeze_start: 0.5"],
  ["freeze_duration: 0.75", "freeze_end: 1.25"]
];

for (const separator of ["", "null@pass,", "metadata=select:key=lavfi.freezedetect.freeze_end,"]) {
  for (const copies of [0, 1, 2]) {
    for (const graph of [false, true]) {
      it(`interleaves freeze diagnostics and ${copies} metadata printers through ${separator || "adjacent filters"} (graph=${graph})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = "freezedetect=n=0:d=0.5" + (separator ? "," + separator.slice(0, -1) : "") +
          Array<string>(copies).fill(",metadata=print").join("");
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "rgba",
            "-video_size", "1x1", "-framerate", "4", "-i", "in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        const selected = separator.startsWith("metadata=select");
        assert.deepEqual(Buffer.concat(stdout), selected ? Buffer.from("14141418fa000018", "hex") : input);
        const headers = [
          `frame:${selected ? 0 : 2}    pts:2       pts_time:0.5`,
          "frame:4    pts:4       pts_time:1",
          `frame:${selected ? 1 : 5}    pts:5       pts_time:1.25`
        ];
        assert.deepEqual(stderr.trim().split("\n"), boundaries.flatMap((tags, index) => [
          ...tags.map(tag => `lavfi.freezedetect.${tag}`),
          ...Array.from({ length: selected && index === 1 ? 0 : copies }, () => [
            headers[index]!, ...tags.map(tag => `lavfi.freezedetect.${tag.replace(": ", "=")}`)
          ]).flat()
        ]));
      });
  }
}
}
