import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [name, input, exitCode, diagnostic, indices] of [
  ["empty startup range", ["-start_number", "3", "-start_number_range", "1", "-i", "f-%02d.png"],
    254, "Could find no file with path 'f-%02d.png' and index in the range 3-3", []],
  ["unmatched glob", ["-pattern_type", "glob", "-i", "absent-*.png"],
    234, "Output file does not contain any stream", []],
  ["default startup range", ["-start_number", "3", "-i", "f-%02d.png"], 0, "", [4, 5]]
] as const) {
  for (const target of ["pipe:1", "/output.raw"]) {
    it(`image2 ${name} returns native status and preserves output: ${target}`, async () => {
      const volume = new Volume();
      for (const index of [1, 2, 4, 5, 8]) {
        const path = `/f-${String(index).padStart(2, "0")}.png`;
        volume.writeFileSync(path, encodeImage({
          width: 2, height: 2, channels: 4,
          data: Uint8Array.from({ length: 16 }, (_, channel) => [20 * index, 0, 0, 255][channel % 4]!),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
        volume.utimesSync(path, 1700000000 + 1.25 * index, 1700000000 + 1.25 * index);
      }
      volume.writeFileSync("/output.raw", "keep");
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "image2", ...input, "-pix_fmt", "rgb24", "-f", "rawvideo", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); },
          async readdir(path: string) { return volume.readdirSync(path, { withFileTypes: true }); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode) {
        assert.ok(stderr.includes(diagnostic), stderr);
        assert.ok(stderr.includes(exitCode === 254 ? "No such file or directory" : "Invalid argument"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(volume.readFileSync("/output.raw", "utf8"), "keep");
      } else {
        assert.equal(stderr, "");
        const bytes = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target);
        assert.deepEqual([...bytes], indices.flatMap(index => Array.from({ length: 4 }, () => [20 * index, 0, 0]).flat()));
      }
    });
  }
}
