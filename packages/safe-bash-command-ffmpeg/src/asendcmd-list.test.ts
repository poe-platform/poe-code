import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Four eight-sample frames at 0, 1, 2 and 3 ms, matching native FFmpeg.
for (const complex of [false, true]) {
  for (const [commands, expected] of [
    ["0.001 volume@v volume 2,volume@v volume 3", [1000, 3000, 3000, 3000]],
    ["0.001 volume@v volume 3,volume@v volume 2", [1000, 2000, 2000, 2000]],
    ["0.001 volume@v volume 2;0.002 volume@v volume 3", [1000, 2000, 3000, 3000]],
    ["0.002 volume@v volume 4;0.001 [enter] volume@v volume 2, [enter] volume@v volume 3", [1000, 3000, 4000, 4000]],
    ["0.001 volume@v volume max(2,3)", [1000, 3000, 3000, 3000]],
    ["0.001 volume@v volume max(2,3),volume@v volume min(4,2)", [1000, 2000, 2000, 2000]],
    ["0.001 volume@missing volume 4,volume@v volume 2", [1000, 2000, 2000, 2000]]
  ] as const) {
    it(`asendcmd dispatches ${commands} (${complex ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(32).fill(1000 / 32768)] }));
      const filter = `asetnsamples=n=8:p=0,asendcmd=c='${commands}',volume@v=1`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.pcm"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.from(await fs.readFile("/out.pcm"));
      assert.equal(output.length, 64);
      assert.deepEqual(Array.from({ length: 32 }, (_, i) => output.readInt16LE(i * 2)),
        expected.flatMap(value => Array<number>(8).fill(value)));
    });
  }
}
