import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [levelArgs, warns] of [
    [[], true], [["-v", "warning"], true], [["-loglevel", "24"], true],
    [["-v", "error"], false], [["-loglevel", "quiet"], false]
  ] as const) {
    it(`dynaudnorm adjusts even windows at ${levelArgs.join(" ") || "default"} level (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      const samples = Float64Array.from({ length: 8137 }, (_, i) =>
        (i % 16 < 8 ? 1 : -1) * [500, 4000, 16000, 1000][Math.floor(i / 2048)]! / 32768);
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      for (const [name, options, adjusted] of [
        ["odd", "f=10:g=5", false],
        ["even", "f=10:g=4", true],
        ["named", "framelen=10:gausssize=4", true],
        ["positional", "10:4", true],
        ["overridden", "f=10:g=4:g=5", false]
      ] as const) {
        let stderr = "";
        const filter = `dynaudnorm=${options}`;
        const result = await createFfmpegCommand().execute({
          args: [...levelArgs, "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", `/${name}.pcm`],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr.includes("filter size 4 is invalid. Changing to an odd value."), warns && adjusted, `${filter}: ${stderr}`);
        assert.equal(fs.statSync(`/${name}.pcm`).size, samples.length * 2);
        assert.deepEqual(fs.readFileSync(`/${name}.pcm`), fs.readFileSync("/odd.pcm"));
      }
    });
  }
}
