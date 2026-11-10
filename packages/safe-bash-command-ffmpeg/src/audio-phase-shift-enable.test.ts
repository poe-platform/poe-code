import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8192 mono PCM16 samples at 8 kHz.
for (const [filter, hash] of [
  ["anull", "b7e75ae36155b3b3f638be2689ab7099d002c9413d98d30c8de40c8642770282"],
  ["afreqshift=250", "dec5b7b9b1c423ef5c61c1ccef4f2b3083904a9335e43a98b3d08590bf8deacf"],
  ["aphaseshift=0.5", "2bbe04db8657672587c0b8ed75d524cb3085aa73eead6f0b70d1e156a2e9e681"],
  ["afreqshift=shift=250:enable=0", "b7e75ae36155b3b3f638be2689ab7099d002c9413d98d30c8de40c8642770282"],
  ["aphaseshift=shift=0.5:enable=0", "b7e75ae36155b3b3f638be2689ab7099d002c9413d98d30c8de40c8642770282"],
  ["afreqshift=shift=250:enable=1", "dec5b7b9b1c423ef5c61c1ccef4f2b3083904a9335e43a98b3d08590bf8deacf"],
  ["aphaseshift=shift=0.5:enable=1", "2bbe04db8657672587c0b8ed75d524cb3085aa73eead6f0b70d1e156a2e9e681"],
  ["afreqshift=shift=250:enable=gte(t\\,0.5)", "ca1de3de887fde9e0893f0ba8cfefd4e0ad682ac901f2defd58cb19fc517c794"],
  ["aphaseshift=shift=0.5:enable=gte(t\\,0.5)", "614d4a6622fd83f8e748398dd413bee091e794db4c8024240edf845afabcce34"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native timeline PCM (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 16384);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

for (const filter of ["afreqshift=250", "aphaseshift=0.5"]) {
  for (const graph of [false, true]) {
    it(`${filter} uses upstream timestamps and frame numbers (${graph ? "graph" : "simple"})`, async () => {
      const expected = await run(filter, graph);
      const shifted = await run(`asetpts=PTS+4096,${filter}:enable='gte(t,0.5)'`, graph);
      assert.equal(shifted.result.exitCode, 0, shifted.stderr);
      assert.deepEqual(shifted.output, expected.output);
      const numbered = await run(`asetnsamples=n=257:p=0,${filter}:enable='not(mod(n,2))'`, graph);
      const timed = await run(`asetnsamples=n=257:p=0,${filter}:enable='not(mod(round(t*8000/257),2))'`, graph);
      assert.equal(numbered.result.exitCode, 0, numbered.stderr);
      assert.equal(timed.result.exitCode, 0, timed.stderr);
      assert.deepEqual(numbered.output, timed.output);
      assert.notDeepEqual(numbered.output, expected.output);
    });
  }
}

for (const name of ["afreqshift", "aphaseshift"]) {
  for (const enable of ["", "unknown", "gte(t,)"]) {
    it(`${name} rejects invalid enable=${enable} without replacing output`, async () => {
      const { result, output } = await run(`${name}=enable='${enable}'`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(output.toString(), "KEEP");
    });
  }
}

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  const period = [0, 4592, 8485, 11087, 12000, 11087, 8485, 4592, 0, -4592, -8485, -11087, -12000, -11087, -8485, -4592];
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 8192 }, (_, i) => period[i % period.length]! / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}
