import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: two sine inputs (440/880 Hz, duration=0.05), -map 0:a -map 1:a
// -c:a aac -program program_num=101:st=0 -program program_num=202:st=1 -f mpegts.
// Expected files: ffmpeg -i adts-copy.mpegts -map 0:N -c copy -f adts adts-copy-N.aac.
const input = readFileSync(new URL("./fixtures/adts-copy.mpegts", import.meta.url));

for (const stream of [0, 1]) {
  for (const format of ["adts", "aac"]) {
    it(`copies TS audio stream ${stream} to ${format} with native ADTS framing and payloads`, async () => {
      const volume = Volume.fromJSON({ "/in.ts": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.ts", "-map", `0:${stream}`, "-c", "copy", "-f", format, "/out.aac"],
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
      assert.deepEqual(volume.readFileSync("/out.aac"),
        readFileSync(new URL(`./fixtures/adts-copy-${stream}.aac`, import.meta.url)));
    });
  }
}
