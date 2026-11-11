import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output: only buffering the second branch delays its EOF.
for (const [name, branches, expected] of [
  ["reversed first branch", "[a]areverse[l];[l][b]", [8, 7, 6, 5, 4, 3]],
  ["unbuffered first branch", "[a]anull[l];[l][b]", [1, 2, 3, 4, 5, 6]],
  ["reversed first branch through linked filters", "[a]acopy[x];[x]areverse@reverse,anull[l];[b]acopy[r];[l][r]", [8, 7, 6, 5, 4, 3]],
  ["reversed second branch", "[b]areverse[r];[a][r]", [1, 2, 3, 4, 5, 6, 3, 3, 6, 5, 4, 3, 2, 1]]
] as const) {
  for (const overlap of [1, 0]) {
    it(`acrossfade matches split EOF with ${name}, overlap=${overlap}`, async () => {
      const input = Buffer.alloc(16);
      for (let index = 0; index < 8; index++) input.writeInt16LE(index + 1, index * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-filter_complex", `[0:a]asplit[a][b];${branches}acrossfade=ns=2:o=${overlap}[out]`,
          "-map", "[out]", "-f", "s16le", "/out.raw"],
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
        name === "reversed second branch" && overlap === 0
          ? [1, 2, 3, 4, 5, 6, 3, 0, 0, 3, 6, 5, 4, 3, 2, 1] : expected);
    });
  }
}
