import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.from("0b00160021002c00c9ffbeffb3ffa8ff", "hex");
for (const sync of [false, true]) {
  for (const codec of ["copy", "pcm_s16le"]) {
    for (const selected of sync ? [0] : [0, 1]) {
      for (const declared of sync ? [0, 8, 16] : [0, 8, 16, 0xffffffff]) {
        for (const value of [undefined, "0", "1"]) {
          it(`${sync ? "sync" : "async"} ${codec} WAV data length ${declared}, ignore_length=${value}, input ${selected}`, async () => {
            const wav = Buffer.from("524946463400000057415645666d74201000000001000100401f0000803e0000020010006461746110000000", "hex");
            wav.writeUInt32LE(declared, 40);
            const volume = Volume.fromJSON({});
            volume.writeFileSync("/in.wav", Buffer.concat([wav, pcm]));
            const args = ["-y", "-v", "error", ...(value === undefined ? [] : ["-ignore_length", value]),
              "-i", "/in.wav", ...(sync ? [] : ["-i", "/in.wav", "-map", `${selected}:a`]), "-c:a", codec, "-f", "s16le", "/out.raw"];
            if (sync) {
              assert.equal(evalSyncFfmpeg(args, undefined,
                name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
                (name, bytes) => { volume.writeFileSync(name, bytes); return true; }), "");
            } else {
              let stderr = "";
              const result = await createFfmpegCommand().execute({
                args, cwd: "/", env: {}, signal: new AbortController().signal,
                fs: {
                  async readFile(name: string) { return volume.readFileSync(name); },
                  async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
                  async stat(name: string) { return volume.statSync(name); }
                },
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
              } as never);
              assert.equal(result.exitCode, 0, stderr);
            }
            assert.deepEqual(volume.readFileSync("/out.raw"), declared === 8 && (value !== "1" || selected === 1) ? pcm.subarray(0, 8) : pcm);
          });
        }
      }
    }
  }
}
