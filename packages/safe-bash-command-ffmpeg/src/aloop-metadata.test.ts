import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 groups input for aloop and emits untagged replay frames.
for (const complex of [false, true]) {
  for (const [filter, samples, frames] of [
    ["aloop=loop=1:size=4", [1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [[0, 0], [2, 8], [3, 10], [4, 13]]],
    ["aloop=loop=0:size=4", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [[0, 0], [1, 4], [2, 8]]],
    ["anull", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [[0, 0], [1, 3], [2, 6], [3, 9]]]
  ] as const) {
    it(`aligns tags and PCM with ${filter} frames (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,ametadata=mode=add:key=k:value=v,${filter},ametadata=mode=print:file=tags`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "-"],
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
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => expected.writeInt16LE(sample * 1000, i * 2));
      assert.deepEqual(Buffer.concat(stdout), expected);
      assert.equal(volume.readFileSync("/tags", "utf8"), frames.map(([n, pts]) =>
        `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${pts / 1000}\nk=v\n`).join(""));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
