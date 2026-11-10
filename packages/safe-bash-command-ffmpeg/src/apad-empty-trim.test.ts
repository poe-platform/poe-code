import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(14);
[0x1234, 0x2345, -0x3457, 0x4234, -0x1235, 0x7812, 0x6000]
  .forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Native FFmpeg 7.0.2 starts padding at zero when atrim emits no frames.
for (const graph of [false, true]) {
  for (const [trim, retained] of [["end_sample=0", 0], ["start_sample=7", 0], ["end_sample=3", 3]] as const) {
    for (const pad of [false, true]) {
      const filter = `atrim=${trim}${pad ? ",apad=pad_len=4:packet_size=2" : ""}`;
      it(`${filter} preserves packet timestamps (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "framecrc", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw", "utf8") as string;
        assert.ok(output.includes("#tb 0: 1/1000"), output);
        const packets = output.split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(value => Number(value.trim())));
        assert.deepEqual(packets.map(packet => packet.slice(1, 5)), [
          ...(retained ? [[0, 0, retained, retained * 2]] : []),
          ...(pad ? [[retained, retained, 2, 4], [retained + 2, retained + 2, 2, 4]] : [])
        ]);
        if (pad) assert.deepEqual(packets.slice(-2).map(packet => packet[5]), [0, 0]);
      });
    }
  }
}
