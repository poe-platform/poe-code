import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: four eight-sample frames starting at 0, 1, 2 and 3 ms.
for (const complex of [false, true]) for (const source of ["c", "commands", "f", "filename"]) {
  for (const [schedule, expected] of [
    ...["0.001", "0.001s", "1ms", "1000us", "+0.001", "0.0010009", "1.0009ms", "00\\:00\\:00.001"]
      .map(time => [`${time} volume@v volume 2`, [1000, 2000, 2000, 2000]] as const),
    ["1.3ms volume@v volume 2", [1000, 1000, 2000, 2000]],
    ["1ms volume@v volume 2;3000us volume@v volume 0", [1000, 2000, 2000, 0]],
    ...["1e-3", "1e3", "0x1", ".001", "NaN", "Infinity", "1MS", "0.001sX"]
      .map(time => [`${time} volume@v volume 2`, null] as const)
  ] as const) {
    it(`asendcmd duration ${schedule} (${complex ? "graph" : "simple"}, ${source})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(32).fill(1000 / 32768)] }));
      await fs.writeFile("/out.pcm", new TextEncoder().encode("keep"));
      const file = source === "f" || source === "filename";
      if (file) await fs.writeFile("/commands.txt", new TextEncoder().encode(schedule.replaceAll("\\:", ":")));
      const filter = `asetnsamples=n=8:p=0,asendcmd=${source}='${file ? "/commands.txt" : schedule}',volume@v=1`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.pcm"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
      const output = Buffer.from(await fs.readFile("/out.pcm"));
      if (expected === null) {
        assert.equal(output.toString(), "keep");
      } else {
        assert.equal(output.length, 64);
        assert.deepEqual(Array.from({ length: 32 }, (_, i) => output.readInt16LE(i * 2)),
          expected.flatMap(value => Array<number>(8).fill(value)));
      }
    });
  }
}
