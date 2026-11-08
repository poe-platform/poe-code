import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independent Python wave input and native FFmpeg Wave64 output.
const wav = Buffer.from("524946463600000057415645666d74201000000001000100401f0000803e00000200100064617461120000000080ffbffffeffff0000010001010140ff7f", "hex");
const w64 = Buffer.from("726966662e91cf11a5d628db04c10000800000000000000077617665f3acd3118cd100c04f8edb8a666d7420f3acd3118cd100c04f8edb8a280000000000000001000100401f0000803e00000200100064617461f3acd3118cd100c04f8edb8a30000000000000000080ffbffffeffff0000010001010140ff7f000000000000", "hex");

for (const direction of ["encode", "decode"]) {
  for (const sync of [false, true]) {
    for (const forced of [false, true]) {
      it(`supports Wave64 ${direction} (${sync ? "sync" : "async"}, ${forced ? "explicit format" : "extension"})`, async () => {
        const input = direction === "encode" ? wav : w64;
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.bin", input);
        const outputPath = direction === "encode" && !forced ? "/out.w64" : "/out.bin";
        const args = ["-v", "error", "-y", ...(forced && direction === "decode" ? ["-f", "w64"] : []), "-i", "/in.bin",
          ...(direction === "decode" ? ["-f", "s16le"] : forced ? ["-f", "w64"] : []), outputPath];
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
        const output = volume.readFileSync(outputPath) as Buffer;
        if (direction === "encode") {
          assert.equal(output.toString("ascii", 0, 4), "riff");
          assert.equal(output.readBigUInt64LE(16), BigInt(output.length));
          assert.equal(output.readUInt16LE(64), 1);
          assert.equal(output.readUInt32LE(68), 8000);
          assert.deepEqual(output.subarray(104, 122), wav.subarray(44));
        } else assert.deepEqual(output, w64.subarray(104));
      });
    }
  }
}
