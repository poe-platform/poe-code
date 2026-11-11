import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [format, pixelBytes] of [
  ["gray16be", 2], ["gray16le", 2], ["rgb48be", 6], ["rgba64be", 8],
  ["gray", 1], ["rgb24", 3], ["rgba", 4]
] as const) {
  for (const [width, height, count] of [[1, 1, 2], [2, 3, 5]] as const) {
    const stride = width * pixelBytes;
    const frameBytes = stride * height;
    const input = Buffer.from(Array.from({ length: frameBytes * count }, (_, i) => (13 + i * 7) % 256));
    for (const filter of ["null", "weave", "weave=first_field=bottom", "doubleweave", "doubleweave=first_field=bottom"]) {
      it(`preserves exact ${format} samples through ${filter} for ${count} ${width}x${height} fields`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", format,
            "-s", `${width}x${height}`, "-r", "2", "-i", "/in.raw", "-vf", `${filter},showinfo`,
            "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
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
        // Doubleweave keeps each field's parity when advancing to the next pair.
        const pairs = count === 2 ? [[0, 1]] : filter.startsWith("doubleweave")
          ? [[0, 1], [2, 1], [2, 3], [4, 3]] : [[0, 1], [2, 3]];
        const expected = filter === "null" ? input : Buffer.concat(pairs.flatMap(pair => {
          const order = filter.endsWith("bottom") ? [...pair].reverse() : pair;
          return Array.from({ length: height }, (_, row) => order.map(frame => {
            const start = frame * frameBytes + row * stride;
            return input.subarray(start, start + stride);
          })).flat();
        }));
        assert.deepEqual(Buffer.concat(stdout), expected);
        const info = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
        assert.equal(info.length, filter === "null" ? count : pairs.length, stderr);
        for (const line of info) {
          assert.ok(line.includes(` s:${width}x${filter === "null" ? height : height * 2} `), line);
        }
      });
    }
  }
}
