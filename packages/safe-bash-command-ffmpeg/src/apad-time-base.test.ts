import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(14);
[0x12345671, 0x23456783, -0x34567897, 0x42345679, -0x1234567f, 0x78123479, 0x60000001]
  .forEach((sample, index) => input.writeInt16LE(sample >> 16, index * 2));

// Packet timestamps from native FFmpeg 7.0.2, in the output's 1/1000 time base.
for (const graph of [false, true]) {
  for (const denominator of [100, 1000]) {
    for (const padding of ["pad_len=4", "whole_len=11", undefined]) {
      it(`apad ${padding ?? "anull control"} with 1/${denominator} time base (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const filter = `asetnsamples=n=3:p=0,asettb=1/${denominator},${padding ? `apad=packet_size=2:${padding}` : "anull"}`;
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
        const packets = output.trim().split("\n").filter(line => !line.startsWith("#"))
          .map(line => line.split(",").map(value => value.trim()));
        const timestamps = denominator === 100 ? [0, 0, 10] : [0, 3, 6];
        if (padding) timestamps.push(...(denominator === 100 ? [10, 10] : [7, 9]));
        assert.deepEqual(packets.map(packet => packet.slice(1, 3).map(Number)), timestamps.map(pts => [pts, pts]));
        assert.deepEqual(packets.map(packet => packet.slice(3, 5).map(Number)),
          padding ? [[3, 6], [3, 6], [1, 2], [2, 4], [2, 4]] : [[3, 6], [3, 6], [1, 2]]);
        if (padding) assert.deepEqual(packets.slice(3).map(packet => packet[5]), ["0x00000000", "0x00000000"]);
      });
    }
  }
}
