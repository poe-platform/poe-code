import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 x86_64: quiet NaN with payload, infinities, then finite controls.
for (const bits of [32, 64]) {
  for (const container of ["raw", "au"]) {
    const format = `f${bits}${container === "au" ? "be" : "le"}`;
    const words = bits === 32
      ? [0x7fc00042n, 0x7f800000n, 0xff800000n, 0n, 1n, 0x80000000n, 0x3f000000n]
      : [0x7ff8000000000042n, 0x7ff0000000000000n, 0xfff0000000000000n, 0n, 1n, 0x8000000000000000n, 0x3fe0000000000000n];
    const payload = Buffer.alloc(words.length * bits / 8);
    words.forEach((word, i) => {
      const offset = i * bits / 8;
      if (bits === 32) {
        if (container === "au") payload.writeUInt32BE(Number(word), offset);
        else payload.writeUInt32LE(Number(word), offset);
      } else if (container === "au") payload.writeBigUInt64BE(word, offset);
      else payload.writeBigUInt64LE(word, offset);
    });
    const header = Buffer.alloc(container === "au" ? 32 : 0);
    if (container === "au") {
      [0x2e736e64, 32, payload.length, bits === 32 ? 6 : 7, 8000, 1]
        .forEach((value, i) => header.writeUInt32BE(value, i * 4));
    }
    for (const output of ["copy", "float", "s16le", "s32le"]) {
      for (const sync of [false, true]) {
        it(`handles non-finite ${format} ${container} to ${output} (${sync ? "sync" : "async"})`, async () => {
          const volume = Volume.fromJSON({});
          volume.writeFileSync("/in", Buffer.concat([header, payload]));
          const args = ["-v", "error", "-y",
            ...(container === "raw" ? ["-f", format, "-ar", "8000", "-ac", "1"] : []), "-i", "/in",
            ...(output === "copy" ? ["-c:a", "copy"] : []),
            "-f", output === "copy" ? container === "au" ? "au" : format : output === "float" ? format : output, "/out"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.readFileSync(path) as Buffer,
              (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          } else {
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(path: string) { return volume.readFileSync(path); },
                async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
                async stat(path: string) { return volume.statSync(path); }
              },
              stdin: (async function* () {})(), stdout: { async write() {} },
              stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
          }
          const bytes = volume.readFileSync("/out") as Buffer;
          if (output === "copy" || output === "float") {
            const data = container === "au" && output === "copy" ? bytes.subarray(bytes.readUInt32BE(4)) : bytes;
            assert.deepEqual(data, payload);
          } else {
            const width = output === "s16le" ? 2 : 4;
            assert.equal(bytes.length, words.length * width);
            assert.deepEqual(words.map((_, i) => bytes.readIntLE(i * width, width)),
              width === 2 ? [0, 0, 0, 0, 0, 0, 16384]
                : [-2147483648, -2147483648, -2147483648, 0, 0, 0, 1073741824]);
          }
        });
      }
    }
  }
}
