import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: only cached input keeps NOPTS; the replay clock advances INT64_MIN.
for (const complex of [false, true]) {
  for (const loop of [1, 2, -1]) {
    for (const select of ["", "isnan(t)", "gte(t,0)", "lt(t,0)"]) {
      if (loop === -1 && select && select !== "lt(t,0)") continue;
      for (const format of select ? ["s16le"] : ["s16le", "framecrc"]) {
        it(`preserves missing aloop input timestamps (${loop}, ${select || "all"}, ${format}, complex=${complex})`, async () => {
          const input = Buffer.alloc(58);
          for (let i = 0; i < 29; i++) input.writeInt16LE(i + 1, i * 2);
          const wav = Buffer.concat([
            Buffer.from("524946465e00000057415645666d74201000000001000100401f0000803e000002001000646174613a000000", "hex"), input
          ]);
          const fs = Volume.fromJSON({ "/in.wav": wav });
          const filter = `asetpts=NAN,aloop=${loop}:4:0${select ? `,aselect='${select}'` : ""},ashowinfo`;
          const stdout: Buffer[] = [];
          let stderr = "";
          const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.1 } }).execute({
            args: ["-v", "info", "-i", "/in.wav",
              ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              ...(loop === -1 ? ["-frames:a", "3"] : []), "-f", format, "-"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return fs.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
              async stat(path: string) { return fs.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const timestamps = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"))
            .map(line => line.split(" ").find(field => field.startsWith("pts:"))!.slice(4));
          const expectedTimestamps = select === "isnan(t)" ? ["NOPTS"] : select === "gte(t,0)" ? [] : [
            ...(select ? [] : ["NOPTS"]),
            ...Array.from({ length: loop === -1 ? select ? 3 : 2 : loop + 1 }, (_, i) => String(-(2n ** 63n) + BigInt((i + 1) * 4)))
          ];
          assert.deepEqual(timestamps, expectedTimestamps);
          const output = Buffer.concat(stdout);
          if (format === "framecrc") {
            const packets = output.toString().split("\n").filter(line => line.startsWith("0,"))
              .map(line => line.split(",").map(field => field.trim()));
            assert.deepEqual(packets, [
              ...Array.from({ length: loop === -1 ? 3 : loop + 1 }, () => ["0", "0", "0", "4", "8", "0x0028000a"]),
              ...(loop === -1 ? [] : [["0", "0", "0", "25", "50", "0x210201a9"]])
            ]);
          } else {
            const expected = select === "isnan(t)" ? input.subarray(0, 8)
              : select === "gte(t,0)" ? Buffer.alloc(0)
              : Buffer.concat([
                ...Array.from({ length: loop === -1 ? 3 : loop + (select ? 0 : 1) }, () => input.subarray(0, 8)),
                ...(loop === -1 ? [] : [input.subarray(8)])
              ]);
            assert.deepEqual(output, expected);
          }
          assert.deepEqual(fs.readFileSync("/in.wav"), wav);
        });
      }
    }
  }
}
