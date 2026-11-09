import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: -i tone.wav -f framemd5 -
const rows = [
  "0,          0,          0,     4096,     8192, 32180763c6c3e07ea7f514a96ed09547",
  "0,       4096,       4096,     4096,     8192, 1ce40bbffbab8e4a40af781a52e1b1ea",
  "0,       8192,       8192,     4096,     8192, 0de8ad7e9b632317fc285bb678b691dc",
  "0,      12288,      12288,     4096,     8192, 70c1af873c8277915ab0d72b3cf5bef5",
  "0,      16384,      16384,     2816,     5632, 770ac58c2f76b5f85c9197c3ab485376"
];

for (const copy of [false, true]) {
  for (const limit of [undefined, 0, 2, 10]) {
    for (const target of ["-", "/out.txt"]) {
      it(`limits PCM frame checksums: copy=${copy}, frames=${limit ?? "unlimited"}, target=${target}`, async () => {
        const volume = Volume.fromJSON({
          "/tone.wav": readFileSync(new URL("./fixtures/pcm-checksum-frame-limit.wav", import.meta.url))
        });
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/tone.wav", ...(copy ? ["-c", "copy"] : []),
            ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", "framemd5", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "-" ? stdout : volume.readFileSync(target, "utf8") as string;
        assert.ok(output.startsWith("#format: frame checksums\n"));
        assert.ok(output.includes("#tb 0: 1/48000\n"));
        assert.ok(output.includes("#stream#, dts,        pts, duration,     size, hash\n"));
        assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#")), rows.slice(0, limit));
      });
    }
  }
}
