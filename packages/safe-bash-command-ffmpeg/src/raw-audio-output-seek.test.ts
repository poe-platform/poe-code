import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: raw 8 kHz mono PCM is copied in 512-sample packets.
for (const format of ["s16le", "wav"]) {
  for (const codec of ["copy", "pcm_s16le"]) {
    for (const [seek, duration] of [[0.1, undefined], [0.064, undefined], [0.1, 0.05]] as const) {
      it(`output seek ${seek}, duration ${duration}, ${codec} to ${format}`, async () => {
        const input = Buffer.alloc(8000);
        for (let i = 0; i < 4000; i++) input.writeInt16LE(i, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            "-ss", String(seek), ...(duration === undefined ? [] : ["-t", String(duration)]),
            "-c:a", codec, "-f", format, "/out"],
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
        const start = codec === "copy" ? Math.ceil(seek * 8000 / 512) * 512 : seek * 8000;
        const end = duration === undefined ? 4000 : codec === "copy" ? 1536 : 1200;
        const data = format === "wav" ? output.indexOf("data") : -8;
        assert.deepEqual(output.subarray(data + 8), input.subarray(start * 2, end * 2));
      });
    }
  }
}
