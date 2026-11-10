import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: stereo s16le at 1 kHz, with two leading silent frames.
const input = Buffer.from("0000000000000000401f00000000803e401f803ec0e000000000000000000000000080c1401f803e0000000000000000401f80c1401f803e0000000000000000", "hex");

for (const [enable, trim] of [
  ["pos", false], ["w", false], ["h", false],
  ["gte(w\\,0)", true], ["gte(h\\,0)", true], ["eq(pos\\,0)", true],
  ["0", false], ["1", true]
] as const) for (const graph of [false, true]) {
  it(`silenceremove enable=${enable} matches native PCM (graph=${graph})`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
    const filter = `silenceremove=start_periods=1:window=0:enable=${enable}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
    assert.deepEqual(volume.readFileSync("/out.raw"), trim ? input.subarray(8) : input);
  });
}
