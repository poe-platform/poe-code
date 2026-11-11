import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 output for twelve mono samples, 1000 through 12000.
for (const [branch, inputs, suffix, expected] of [
  ["areverse", "[a][b]", "aselect=eq(n\\,1)", "4b04c5040205"],
  ["areverse", "[b][a]", "aselect=eq(n\\,1)", "4b04c5040205"],
  ["areverse", "[a][b]", "anull", "6e019f0294034b04c50402050205c5044b0494039f026e01"],
  ["anull", "[a][b]", "aselect=eq(n\\,1)", "e801fb024b04"]
] as const) {
  it(`amultiply retains post-split regrouping: ${branch}, ${inputs}, ${suffix}`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] }));
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]${branch}[a];[y]asetnsamples=n=3:p=0[b];${inputs}amultiply,${suffix}[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
