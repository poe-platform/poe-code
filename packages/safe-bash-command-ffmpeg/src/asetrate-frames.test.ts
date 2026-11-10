import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: changing the rate retains the WAV decoder's 512-sample frames.
for (const graph of [false, true]) {
  for (const [filter, selected, hash] of [
    ["asetrate=4000,aselect=eq(n\\,1)", true, "26c0efcb13efa77a7c35b3c1b75bf58e192afad311c6791b2a79a6b59ed295c8"],
    ["asetrate=4000,volume=if(eq(n\\,1)\\,0\\,1):eval=frame", false, "a7a5031563cd8efc1fd0c21261577dd617d79d4f7dadeb4348d794e38b482373"],
    ["asetrate=4000", false, "3b1a86d3d5b3270120685f795fd3ea9b42d3298f90a6c90f8882988f3c57ef67"],
    ["aselect=eq(n\\,1)", true, "26c0efcb13efa77a7c35b3c1b75bf58e192afad311c6791b2a79a6b59ed295c8"],
    ["asetrate=8000", false, "3b1a86d3d5b3270120685f795fd3ea9b42d3298f90a6c90f8882988f3c57ef67"]
  ] as const) {
    it(`${filter} retains native frames (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 4707 }, (_, i) => (i - 2000) / 32768)] }));
      let stderr = "";
      const chain = `${filter},ashowinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.raw"],
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
      assert.equal(output.length, selected ? 1024 : 9414);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
      assert.deepEqual(frames.map(line => {
        const fields = line.split(" ");
        return ["n:", "pts:", "nb_samples:"].map(key => Number(fields.find(field => field.startsWith(key))!.slice(key.length)));
      }), selected ? [[0, 512, 512]] : Array.from({ length: 10 }, (_, n) => [n, n * 512, n === 9 ? 99 : 512]));
    });
  }
}
