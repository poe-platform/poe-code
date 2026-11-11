import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/alimiter-timeline.wav", import.meta.url));
async function run(filter: string, graph: boolean, inputBytes: Uint8Array = input) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(inputBytes), "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [enable, delayed] of [["eq(pos\\,44)", true], ["eq(pos\\,45)", false], ["1", true], ["0", false]] as const) {
    it(`uses WAV packet position in alimiter enable=${enable} (${graph ? "graph" : "simple"})`, async () => {
      const samples = [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
        9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000];
      const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] });
      const { result, stderr, output } = await run(`alimiter=attack=0.5:level=0:enable=${enable}`, graph, wav);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "ffmpeg: Guessed Channel Layout: mono\n");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        delayed ? [0, 0, 0, ...samples.slice(0, -3)] : samples);
    });
  }

  // Complete PCM16 references from native FFmpeg 7.0.2, using the same WAV.
  for (const [filter, hash, count = 3087] of [
    ["alimiter=limit=0.25:level=0:enable=gte(t\\,0.1)", "6bed54dee269e8cd5ea2122ddd37b939cbe8e82e0f7c5be1ed7a0479d0915619"],
    ["alimiter=limit=0.25:level=0:enable=mod(n\\,2)", "a85c2fcb165bc7cd53f9e77c6be76f38d44ec261aebabcd02e55af1ece7ef287"],
    ["asetpts=PTS+800,alimiter=limit=0.25:level=0:enable='gte(t,0.1)'", "89fe3341b95f68d9c55ae8eb7b747a2515a2be8a724075bed5cf3b88cae3276d"],
    ["asetnsamples=n=200:p=0,alimiter=limit=0.25:level=0:enable=gte(t\\,0.1)", "277b6ecc79979ec5d3ff8cc889b360a181a4109854efaaa4903c2f2f1daa6087"],
    ["alimiter=limit=0.25:level=0:latency=1:enable=gte(t\\,0.1)", "2aeb45b382eb20c29b78772080b454345136f41093dbad033379c33b71d02468"],
    ["alimiter=limit=0.25:level=0:latency=1:enable=mod(n\\,2)", "fe80eb25cf06cd3543d71b1a5f4f55cb1c2a858ebc781df58f09a74ba9fd7b09"],
    ["alimiter=limit=0.25:level=0:latency=1:enable=mod(n\\,2),aselect=eq(n\\,0)", "6307b968966b69abddad48028f58f47630178534409a5ab031110f3617200478", 512],
    ["alimiter=limit=0.25:level=0:latency=1:enable=mod(n\\,2),aselect=eq(n\\,1)", "315af2f68a9114660ee932a71e649bc8c6443fcdb72c186355b046b83a16e3fd", 473],
    ["alimiter=limit=0.25:level=0:latency=1:enable=mod(n\\,2),aselect=eq(t\\,0.128)", "e844dcddf4abf25a7e89b8990fbba97b1115dff9404a907ac59f2650af23c912", 512],
    ["alimiter=limit=0.25:level=0:latency=1:enable=mod(n\\,2),aselect=eq(t\\,0.32)", "ad67b0a438d15a021acd69b39c166286576585a0b4bec3e1a867e894922b4e4b", 512]
  ] as const) {
    it(`matches native timeline PCM for ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, count * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "alimiter=limit=0.25:level=0:enable=gte(t\\,0.1)") {
        assert.deepEqual([0, 1, 1024, 1025].map(i => output.readInt16LE(i * 2)), [24907, -29889, 0, 0]);
      }
    });
  }

  for (const latency of [0, 1]) for (const enable of ["0", "0.25", "1", "-1"]) {
    it(`alimiter enable=${enable}, latency=${latency} matches constant gating (${graph ? "graph" : "simple"})`, async () => {
      const filter = `alimiter=limit=0.25:level=0:latency=${latency}`;
      const expected = await run(Math.abs(Number(enable)) >= 0.5 ? filter : "anull", graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      const actual = await run(`${filter}:enable=${enable}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`rejects invalid alimiter enable=${enable} without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(`alimiter=enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("alimiter"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
