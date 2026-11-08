import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: two sine inputs (440/880 Hz, duration=0.05), -map 0:a -map 1:a
// -c:a aac -program program_num=101:st=0 -program program_num=202:st=1 -f mpegts.
// Expected files: ffmpeg -i adts-copy.mpegts -map 0:N -c copy -f adts adts-copy-N.aac.
const input = readFileSync(new URL("./fixtures/adts-copy.mpegts", import.meta.url));

for (const [maps, ordinal] of [
  [["0:p:101"], 0], [["0:p:202"], 1], [["0:p:202:a:0"], 1],
  [["0", "-0:p:101"], 1], [["0:p:999?", "0:p:202"], 1],
  [["0:p:999"], -1]
] as const) {
  it(`selects MPEG-TS programs with ${maps.join(" ")}`, async () => {
    const volume = Volume.fromJSON({ "/in.ts": input });
    for (const [selectors, output] of [[maps, "/program.mp4"], [[`0:${ordinal}`], "/ordinal.mp4"]] as const) {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.ts", ...selectors.flatMap(map => ["-map", map]), "-c", "copy", output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (ordinal === -1) {
        assert.equal(result.exitCode, 234);
        assert.match(stderr, /matches no streams/);
        assert.equal(volume.existsSync(output), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
    }
    assert.deepEqual(volume.readFileSync("/program.mp4"), volume.readFileSync("/ordinal.mp4"));
  });
}
