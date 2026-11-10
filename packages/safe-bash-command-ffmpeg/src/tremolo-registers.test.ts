import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8192 mono PCM16 samples of 8192 at 8 kHz.
for (const [expression, control, hash] of [
  ["tremolo=d=st(0\\,0.25)", "tremolo=d=0.25", "5f2f0db23738d76e49fd8838b7ad19edc9824742093ca157edf110aec41757d1"],
  ["tremolo=f=ld(0)+5", "tremolo=f=5", "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["tremolo=enable=ld(0)", "tremolo=enable=0", "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"],
  ["asetnsamples=n=128,tremolo=enable=mod(st(0\\,ld(0)+1)\\,2)", "asetnsamples=n=128,anull", "7ef57a19203e6be11e319a8fa5a346dbed8245b8c7996f8e8031567c7dca4d05"]
] as const) {
  for (const graph of [false, true]) {
    for (const filter of [expression, control]) {
      it(`${filter} matches native register PCM (${graph ? "graph" : "simple"})`, async () => {
        const pcm = await run(filter, graph);
        assert.equal(pcm.length, 16384);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
  }
}

for (const [expression, control] of [
  ["tremolo=f=st(0\\,5):d=ld(0)+0.25", "tremolo=f=5:d=0.25"],
  ["tremolo=d=st(0\\,1):enable=ld(0)", "anull"],
  ["tremolo=enable='st(0,ld(0)+1);eq(ld(0),4)'", "tremolo=enable='eq(n,1)'"],
  ["tremolo=enable='st(0,ld(0)+1);eq(ld(0),2)',tremolo=enable=ld(0)", "tremolo=enable='eq(n,0)'"],
  ["tremolo=enable='if(0,st(0,1),ld(0))'", "anull"]
] as const) {
  for (const graph of [false, true]) {
    it(`${expression} keeps registers scoped and evaluates each frame twice (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(`asetnsamples=n=128,${expression}`, graph);
      const expected = await run(`asetnsamples=n=128,${control}`, graph);
      assert.deepEqual(actual, expected);
    });
  }
}

async function run(filter: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000, channels: [new Float64Array(8192).fill(0.25)]
  }, { bitsPerSample: 16 }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
  return volume.readFileSync("/out.raw") as Buffer;
}
