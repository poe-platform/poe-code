import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for the 32-sample ramp below at gains 0, 1 and 2.
const hashes = [
  "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
  "15960665b6431b1ddc89a29b155196ef3a691875bc7346e1999f601873284598",
  "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"
];

for (const complex of [false, true]) {
  for (const gain of ["level_in", "level_out"]) {
    for (const [expression, expected] of [
      ["isnan(0/0)", 1], ["isinf(1/0)", 1], [String.raw`if(isnan(0/0)\,2\,3)`, 2],
      ["1", 1], ["2", 2], ["isnan(1)", 0], ["0", 0],
      ["0/0", undefined], ["1/0", undefined], ["sqrt(-1)", undefined],
      [String.raw`if(isinf(1/0)\,65\,1)`, undefined]
    ] as const) {
      it(`evaluates aemphasis ${gain}=${expression} (${complex ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(64);
        for (let i = 0; i < 32; i++) input.writeInt16LE(i * 300 - 4000, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `aemphasis=${gain}=${expression}`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const output = Buffer.concat(chunks);
        if (expected === undefined) {
          assert.notEqual(result.exitCode, 0);
          assert.equal(output.length, 0);
          assert.match(stderr, /aemphasis:/);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.equal(output.length, input.length);
          assert.equal(createHash("sha256").update(output).digest("hex"), hashes[expected]);
        }
      });
    }
  }
}
