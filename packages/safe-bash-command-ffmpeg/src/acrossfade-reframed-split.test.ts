import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 16 }, (_, i) => (-1) ** i * (16001 + i * 231));

// Complete PCM16 outputs from FFmpeg 7.0.2: regrouping only the first branch
// still drains the unbuffered second branch to EOF before the transition.
for (const [name, branches, firstReframed] of [
  ["first branch", "[x]asetnsamples=n=4:p=0[a];[y]anull[b]", true],
  ["second branch", "[x]anull[a];[y]asetnsamples=n=4:p=0[b]", false],
  ["linked named first branch", "[x]acopy[c];[c]asetnsamples@frames=n=4:p=0,anull[a];[y]acopy[b]", true]
] as const) {
  for (const overlap of [1, 0]) {
    it(`acrossfade matches split EOF with reframed ${name}, overlap=${overlap}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(input, value => value / 32768)] }));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
          `[0:a]asplit=2[x][y];${branches};[a][b]acrossfade=ns=4:o=${overlap}[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const expected = firstReframed ? input.slice(0, 12) : [
        ...input.slice(0, 12),
        ...(overlap ? [14079, -13560, 13040, -12520] : [14079, -9502, 4808, 0, 0, -4058, 8231, -12520]),
        ...input.slice(4)
      ];
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
