import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 11 }, (_, index) => (index + 1) * 100);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// PCM, packet rows, and filter timestamps captured from native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const [expression, missingLast] of [
    ["NAN", true], ["if(eq(N\\,8)\\,NAN\\,PTS)", true],
    ["PTS", false], ["if(eq(N\\,4)\\,NAN\\,PTS)", false]
  ] as const) {
    for (const mode of ["pcm", "trim", "no-pad", "framecrc", "ashowinfo"] as const) {
      it(`apad missing PTS: ${expression}, ${mode} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=4:p=0,asetpts=${expression}`
          + (mode === "no-pad" ? "" : ",apad=pad_len=9:packet_size=4")
          + (mode === "trim" || mode === "no-pad" ? ",atrim=start=0.010:end=0.018" : "")
          + (mode === "ashowinfo" ? ",ashowinfo" : "");
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", mode === "ashowinfo" ? "info" : "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", mode === "framecrc" ? "framecrc" : "s16le", "/out"],
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
        const output = volume.readFileSync("/out") as Buffer;
        if (mode === "framecrc") {
          const packets = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
            .map(line => line.split(",").map(value => value.trim()));
          const timestamps = [0, 4, 8, ...(missingLast ? [8, 8, 8] : [11, 15, 19])];
          assert.deepEqual(packets.map(packet => packet.slice(1, 3).map(Number)), timestamps.map(pts => [pts, pts]));
          assert.deepEqual(packets.map(packet => packet.slice(3, 5).map(Number)), [[4, 8], [4, 8], [3, 6], [4, 8], [4, 8], [1, 2]]);
          assert.deepEqual(packets.map(packet => packet[5]),
            ["0x09a401ea", "0x0cfa0230", "0x076c01c2", "0x00000000", "0x00000000", "0x00000000"]);
        } else {
          const expected = mode === "no-pad" || mode === "trim" && missingLast ? [1100]
            : mode === "trim" ? [1100, ...Array<number>(7).fill(0)] : [...samples, ...Array<number>(9).fill(0)];
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
          if (mode === "ashowinfo") {
            const timestamps = missingLast ? [-9223372036854775805n, -9223372036854775801n, -9223372036854775797n] : [11n, 15n, 19n];
            for (const [index, pts] of timestamps.entries()) {
              assert.ok(stderr.includes(`n:${index + 3} pts:${pts} `), stderr);
            }
          }
        }
      });
    }
  }
}
