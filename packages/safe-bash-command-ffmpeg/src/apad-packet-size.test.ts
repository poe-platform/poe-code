import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  const samples = channels === 1 ? [101, 102, 103, 104, 105, 106, 107, 108] : [101, -901, 202, -802, 303, -703];
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

  // FFmpeg 7.0.2 emits the input frame followed by one padding packet.
  for (const graph of [false, true]) {
    for (const [value, packetSize] of [
      ["3/2", 2], ["1.5", 2], ["2.5", 2], ["3.5", 4],
      ["1+2", 3], ["3", 3], ["0x2", 2], ["0b10", null], ["0o2", null],
      ["'PI'", 3], ["'E'", 3], ["'PHI'", 2], ["'sqrt(9)'", 3],
      ["'PI*2'", 6], ["pi", null]
    ] as const) {
      it(`apad packet_size=${value} (${channels}ch, ${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        let writes = 0;
        const filter = `apad=packet_size=${value}:pad_len=${packetSize === null ? 3 : 10}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(packetSize === null ? ["-t", "0.001"] : ["-frames:a", "2"]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { writes++; volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (packetSize === null) {
          assert.equal(result.exitCode, 234, stderr);
          assert.ok(stderr.includes("apad"), stderr);
          assert.equal(writes, 0);
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const output = volume.readFileSync("/out.raw") as Buffer;
          assert.deepEqual(output, Buffer.concat([input, Buffer.alloc(packetSize * channels * 2)]));
        }
      });
    }
  }
}
