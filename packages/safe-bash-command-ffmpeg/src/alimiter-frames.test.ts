import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Frame boundaries and timestamps verified with native FFmpeg.
for (const graph of [false, true]) {
  for (const [filter, start, count, mute, length = 3087] of [
    ["alimiter=latency=1,aselect=eq(n\\,0)", 0, 473, 0],
    ["alimiter=latency=1,aselect=eq(n\\,1)", 473, 512, 0],
    ["alimiter=latency=1,aselect=eq(n\\,7)", 3048, 39, 0],
    // Native t multiplies integer PTS by TB; decimal 0.059125 differs by one ULP.
    ["alimiter=latency=1,aselect=eq(t\\,0.059125)", 0, 0, 0],
    ["alimiter=latency=1,aselect=eq(t\\,473*TB)", 473, 512, 0],
    ["alimiter=latency=1,volume=0:enable=eq(n\\,0)", 0, 3087, 473],
    ["alimiter=latency=1,volume=0:enable=eq(n\\,7)", 0, 3087, 0],
    ["alimiter=latency=0,aselect=eq(n\\,0)", 0, 512, 39],
    ["alimiter=latency=1,aselect=eq(n\\,0)", 0, 7, 0, 7],
    ["asetpts=PTS+800,alimiter=latency=1,aselect=eq(t\\,0.1)", 0, 7, 0, 7],
    ["asetpts=PTS+800,alimiter=latency=1,aselect=eq(t\\,0.481)", 3048, 39, 0],
    ["alimiter=attack=80:latency=1,aselect=eq(n\\,0)", 0, 385, 0],
    ["alimiter=attack=80:latency=1,aselect=eq(n\\,6)", 2448, 639, 0],
  ] as const) {
    it(`preserves limiter output frames: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length }, (_, i) => (100 + i) / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); },
          async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
          async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, count * 2);
      for (let i = 0; i < count; i++) {
        const delayed = filter.includes("latency=0");
        const tailMuted = filter.includes("volume=0:enable=eq(n\\,7)") && i >= 3048;
        assert.equal(output.readInt16LE(i * 2), i < mute || tailMuted ? 0 : 100 + start + i - (delayed ? 39 : 0), `sample ${i}`);
      }
    });
  }
}
