import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand, evalSyncFfmpeg } from "./index.js";

for (const samples of [[], [100, -200, 300, -400]]) {
  for (const size of [0, 0xffffffff, ...(samples.length ? [samples.length * 2] : [])]) {
    for (const mode of ["sync", "async", "probe"]) {
      it(`AU size=${size}, ${samples.length} samples, ${mode}`, async () => {
        const input = Buffer.alloc(32 + samples.length * 2);
        [0x2e736e64, 32, size, 3, 8000, 1].forEach((value, i) => input.writeUInt32BE(value, i * 4));
        samples.forEach((value, i) => input.writeInt16BE(value, 32 + i * 2));
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        volume.writeFileSync("/in.au", input);
        const args = ["-v", "error", "-y", "-i", "/in.au", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
        const valid = size !== 0;
        if (mode === "sync") {
          const result = evalSyncFfmpeg(args, undefined,
            name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
            (name, bytes) => { volume.writeFileSync(name, bytes); return true; });
          assert.equal(result, valid ? "" : undefined);
        } else {
          let stdout = "", stderr = "";
          const result = await (mode === "probe" ? createFfprobeCommand() : createFfmpegCommand()).execute({
            args: mode === "probe" ? ["-v", "error", "-show_streams", "-of", "json", "/in.au"] : args,
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(name: string) { return volume.readFileSync(name); },
              async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
              async stat(name: string) { return volume.statSync(name); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, valid || mode === "probe" ? 0 : 1, stderr);
          if (mode === "probe" && size === 0) assert.equal(JSON.parse(stdout).streams[0].duration_ts, 0);
        }
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (!valid || mode === "probe") assert.equal(output.toString(), "keep");
        else {
          assert.equal(output.length, samples.length * 2);
          assert.deepEqual(samples.map((_, i) => output.readInt16LE(i * 2)), samples);
        }
      });
    }
  }
}
