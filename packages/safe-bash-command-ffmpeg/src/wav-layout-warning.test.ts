import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-28001, -19003, -12007, -3001, 3001, 12007, 19003, 28001];

for (const copy of [false, true]) {
  for (const mask of [undefined, 0, 4]) {
    for (const level of ["warning", "error"]) {
      for (const guess of [true, false]) {
        it(`reports a guessed mono WAV layout with mask ${mask}, level ${level}, guessing ${guess}, copy ${copy}`, async () => {
          const fmt = Buffer.alloc(mask === undefined ? 16 : 40);
          fmt.writeUInt16LE(mask === undefined ? 1 : 0xfffe, 0);
          fmt.writeUInt16LE(1, 2);
          fmt.writeUInt32LE(8000, 4);
          fmt.writeUInt32LE(16000, 8);
          fmt.writeUInt16LE(2, 12);
          fmt.writeUInt16LE(16, 14);
          if (mask !== undefined) {
            fmt.writeUInt16LE(22, 16);
            fmt.writeUInt16LE(16, 18);
            fmt.writeUInt32LE(mask, 20);
            fmt.set(Buffer.from("0100000000001000800000aa00389b71", "hex"), 24);
          }
          const pcm = Buffer.alloc(samples.length * 2);
          samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
          const wav = Buffer.alloc(28 + fmt.length + pcm.length);
          wav.write("RIFF");
          wav.writeUInt32LE(wav.length - 8, 4);
          wav.write("WAVEfmt ", 8);
          wav.writeUInt32LE(fmt.length, 16);
          wav.set(fmt, 20);
          wav.write("data", 20 + fmt.length);
          wav.writeUInt32LE(pcm.length, 24 + fmt.length);
          wav.set(pcm, 28 + fmt.length);
          const volume = Volume.fromJSON({ "/in.wav": wav });
          const output: Buffer[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-nostats", "-v", level,
              ...(!guess ? ["-guess_layout_max", "0"] : []),
              "-i", "/in.wav", ...(copy ? ["-c:a", "copy"] : ["-af", "anull"]),
              "-f", copy ? "s16le" : "s32le", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const expected = Buffer.alloc(samples.length * 4);
          samples.forEach((sample, index) => expected.writeInt32LE(sample * 65536, index * 4));
          assert.deepEqual(Buffer.concat(output), copy ? pcm : expected);
          if (level === "warning" && guess && !mask) {
            assert.ok(stderr.includes("Guessed Channel Layout: mono"), stderr);
            assert.equal(stderr.trim().split("\n").length, 1);
          } else {
            assert.equal(stderr, "");
          }
        });
      }
    }
  }
}
