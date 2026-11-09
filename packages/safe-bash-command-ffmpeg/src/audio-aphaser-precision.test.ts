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

async function run(input: Uint8Array, filter: string, format: string, graph: boolean) {
  const volume = new Volume();
  volume.writeFileSync("/in.wav", input);
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
