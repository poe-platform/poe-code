import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 fixtures and signed high-bit conversion results.
const inputs = {
  wav: Buffer.from("524946468400000057415645666d74201000000001000100401f000000fa000008004000646174616000000000000000000000000100000000000000ffffffffffffffff0300000000008000fdffffffffff7fff1100000000000040efffffffffffffbfffffffffffffff7f000000000000008001000080000000000100000056341240ffffffffa9cbedbf", "hex"),
  w64: Buffer.from("726966662e91cf11a5d628db04c10000e00000000000000077617665f3acd3118cd100c04f8edb8a666d7420f3acd3118cd100c04f8edb8a4000000000000000feff0100401f000000fa00000800400016004000040000000100000000001000800000aa00389b7164617461f3acd3118cd100c04f8edb8a780000000000000000000000000000000100000000000000ffffffffffffffff0300000000008000fdffffffffff7fff1100000000000040efffffffffffffbfffffffffffffff7f000000000000008001000080000000000100000056341240ffffffffa9cbedbf", "hex")
};
const expected = {
  s32le: [0, 0, -1, 8388608, -8388609, 1073741824, -1073741825, 2147483647, -2147483648, 0, 1074934870, -1074934871],
  s16le: [0, 0, -1, 128, -129, 16384, -16385, 32767, -32768, 0, 16402, -16403]
};

for (const [container, input] of Object.entries(inputs)) {
  for (const format of ["s32le", "s16le", "copy"] as const) {
    for (const sync of [false, true]) {
      it(`converts PCM64 ${container} to ${format} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync(`/in.${container}`, input);
        const args = ["-v", "error", "-y", "-i", `/in.${container}`, ...(sync ? [] : ["-map", "0:a"]), "-c:a",
          format === "copy" ? "copy" : `pcm_${format}`, "-f", format === "copy" ? "wav" : format, "/out.raw"];
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
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (format === "copy") {
          const offset = output.indexOf("data") + 8;
          assert.deepEqual(output.subarray(offset, offset + output.readUInt32LE(offset - 4)), input.subarray(-96));
        } else {
          const width = format === "s32le" ? 4 : 2;
          assert.equal(output.length, expected[format].length * width);
          assert.deepEqual(expected[format].map((_, i) => output.readIntLE(i * width, width)), expected[format]);
        }
      });
    }
  }
}
