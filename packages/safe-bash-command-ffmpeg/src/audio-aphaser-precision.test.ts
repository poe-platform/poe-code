import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Raw PCM SHA-256 from native FFmpeg 9.0.1; all samples stay below full scale.
for (const [bits, format, control, phased] of [
  [64, "f64le", "c6fd2f30479e0a25ba68f13bbf6ea851e6e6c90b3b806a6139cd98f52fb1fbb8", "a09f58648f65e74081d4e1e9569f9b9b3a8d085216392805546891f7da67786c"],
  [64, "s16le", "273aab3b352207dd1f6c96611e089321c3424a61cf5bc26210908e17dd980db2", "49bc3bddda8e41984b386770f082bbc830d7163ed1ab8bf725c1252edba7b492"],
  [32, "s32le", "d11aa17347190092f31570d89e96507658179666bae4d70bad124e800162a92e", "f62624292ec987be5bad1ffc71c0d726b5f939ad56b743752c1772215998c4e8"],
  [24, "s32le", "d11aa17347190092f31570d89e96507658179666bae4d70bad124e800162a92e", "f62624292ec987be5bad1ffc71c0d726b5f939ad56b743752c1772215998c4e8"]
] as const) {
  for (const graph of [false, true]) {
    for (const [filter, hash] of [["anull", control], ["aphaser", phased]] as const) {
      it(`${filter} preserves ${bits}-bit input precision through ${format} (${graph ? "graph" : "simple"})`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 12000 }, (_, i) => ((i * 67) % 14000 - 7000) / 8192)
        ] }, { bitsPerSample: bits, float: bits === 64 });
        const { volume, result, stderr } = await run(input, filter, format, graph);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        if (format === "f64le" && filter === "aphaser") {
          // Native builds may fuse multiply-adds: allow double rounding, never float32 rounding.
          for (const [frame, expected] of [[4, -0.403714515625], [16, -0.359682001075831],
            [23, -0.3314382594280627], [45, -0.24267198350694447]] as const) {
            assert.ok(Math.abs(output.readDoubleLE(frame * 8) - expected) <= 2e-16);
          }
        } else {
          assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        }
      });
    }
  }
}

// Complete destination hashes from native FFmpeg 7.0.2, including implicit conversions.
for (const [source, format, working, hash] of [
  ["u8", "f64le", "dbl", "d0fe2b147da4b5fbddfd9b390302965ca8357b2e9d277a4f65a48b13dc70f575"],
  ["u8p", "s16le", "s16", "d6802aadc4cd5aa72d57a3fa8d433a07726a77b977a918b400e470576f8a26a6"],
  ["s64", "s16le", "s16", "a131cc632affa5d8e011b45e4baafd4b6d7dfdc47a3727a560f5044255fda00c"],
  ["s64p", "s16le", "s16", "a131cc632affa5d8e011b45e4baafd4b6d7dfdc47a3727a560f5044255fda00c"]
] as const) {
  for (const graph of [false, true]) {
    for (const explicit of [false, true]) {
      it(`aphaser negotiates ${source} through ${format} (${graph ? "graph" : "simple"}, ${explicit ? "explicit" : "implicit"})`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 16 }, (_, i) => ((i * 7919 + 3467) % 49001 - 24500) / 32768)
        ] }, { bitsPerSample: 16 });
        const filter = `aformat=sample_fmts=${source},${explicit ? `aformat=sample_fmts=${working},` : ""}aphaser`;
        const { volume, result, stderr } = await run(input, filter, format, graph);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 16 * (format === "f64le" ? 8 : 2));
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }
}

for (const [source, format, hash] of [
  ["u8", "f64le", "9f39dcc75cb918b7dade5a27032b2629b58f48659bfc0cccac6e51cdd01c51a2"],
  ["s64", "s16le", "1a533a93c97558cd6d93d24fe4d18f9a9a2e4acfe80dc54aabb64fe94f47c3c2"]
] as const) {
  it(`converts ${source} through ${format} without aphaser`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 16 }, (_, i) => ((i * 7919 + 3467) % 49001 - 24500) / 32768)
    ] }, { bitsPerSample: 16 });
    const { volume, result, stderr } = await run(input, `aformat=sample_fmts=${source}`, format, false);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 16 * (format === "f64le" ? 8 : 2));
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

// Full-buffer reference hashes from native FFmpeg 7.0.2 for the stereo regression.
for (const [source, downstream, working, hash] of [
  ["u8", "anull", "dbl", "b5e438cf01f11e8253fa4c8e2b6206a0e57518c39344a44c69ec82ad17429e3a"],
  ["u8", "anull,acopy", "dbl", "b5e438cf01f11e8253fa4c8e2b6206a0e57518c39344a44c69ec82ad17429e3a"],
  ["s64", "aformat=sample_fmts=s32", "s32", "e55f1f43fa730334ae67f1f36048abbc7ccc5dc16b60bd9aa52226a922d28818"],
  ["s64", "anull,aformat=f=s32,acopy", "s32", "e55f1f43fa730334ae67f1f36048abbc7ccc5dc16b60bd9aa52226a922d28818"]
] as const) {
  for (const graph of [false, true]) {
    it(`aphaser negotiates ${source} through ${downstream} (graph=${graph})`, async () => {
      const input = encodeWav({ sampleRate: 1000, channels: [
        Float64Array.from({ length: 16 }, (_, i) => ((i * 97) % 30001 - 15000) / 32768),
        Float64Array.from({ length: 16 }, (_, i) => ((i * 257) % 20001 - 10000) / 32768)
      ] }, { bitsPerSample: 16 });
      const outputs: Buffer[] = [];
      for (const explicit of [false, true]) {
        const filter = `aformat=sample_fmts=${source},${explicit ? `aformat=sample_fmts=${working},` : ""}aphaser,${downstream}`;
        const { volume, result, stderr } = await run(input, filter, "f64le", graph);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 256);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        outputs.push(output);
      }
      assert.deepEqual(outputs[0], outputs[1]);
    });
  }
}

async function run(input: Uint8Array, filter: string, format: string, graph: boolean) {
  const volume = new Volume();
  volume.writeFileSync("/in.wav", input);
  volume.writeFileSync("/out.raw", "KEEP");
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 3 } }).execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
