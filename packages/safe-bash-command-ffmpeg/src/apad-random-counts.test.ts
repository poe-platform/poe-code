import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: eight mono PCM16 samples at 8 kHz, capped at 8 ms.
for (const [options, samples] of [
  ["pad_len=3", 11],
  ["pad_len='randomi(0,2,6)'", 11],
  ["pad_len=4", 12],
  ["pad_len='4+random(0)'", 12],
  ["whole_len='randomi(0,10,14)'", 11],
  ["whole_len='12+random(0)'", 12],
  ["pad_len='randomi(0,2,6)+randomi(0,2,6)'", 17],
  ["pad_len='randomi(0,2,6)':pad_len='randomi(0,2,6)'", 11],
  ["pad_len='randomi(0,2)'", undefined],
  ["whole_len='random(0,1)'", undefined]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${options} matches native sample counts (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("6400c8002c019001f4015802bc022003", "hex");
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.pcm": input });
        const output: Buffer[] = [];
        let stderr = "";
        const filter = `apad=${options}`;
        const result = await command.execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-t", "0.008", "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (samples === undefined) {
          assert.equal(result.exitCode, 234);
          assert.ok(stderr.includes("apad: invalid or unsupported expression"), stderr);
          assert.equal(Buffer.concat(output).length, 0);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.deepEqual(Buffer.concat(output), Buffer.concat([input, Buffer.alloc((samples - 8) * 2)]));
        }
      }
    });
  }
}
