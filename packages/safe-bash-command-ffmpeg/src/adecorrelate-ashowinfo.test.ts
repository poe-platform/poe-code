import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 diagnostics for the same 32-sample PCM16 input.
for (const graph of [false, true]) {
  for (const [filter, format, checksum, planes] of [
    ["adecorrelate=seed=42", "dblp", "087CF481", "6A207E93 03EB75EE"],
    ["adecorrelate=seed=42,anull", "dblp", "087CF481", "6A207E93 03EB75EE"],
    ["anull", "s16", "4A403AC4", "4A403AC4"]
  ] as const) it(`${filter} exposes native sample planes (${graph ? "graph" : "simple"})`, async () => {
    const channels = [
      Float64Array.from({ length: 32 }, (_, i) => ((i * 1237) % 30001 - 15000) / 32768),
      Float64Array.from({ length: 32 }, (_, i) => (10000 - (i * 937) % 20001) / 32768)
    ];
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter},ashowinfo[out]`, "-map", "[out]"]
        : ["-af", `${filter},ashowinfo`]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const records = stderr.trim().split("\n").filter(line => line.includes(" n:"));
    assert.deepEqual(records.map(line => line.slice(line.indexOf(" n:") + 1)), [
      `n:0 pts:0 pts_time:0 fmt:${format} channels:2 chlayout:stereo rate:48000 nb_samples:32 checksum:${checksum} plane_checksums: [ ${planes} ]`
    ]);
    assert.equal((fs.readFileSync("/out.pcm") as Buffer).length, 32 * 2 * 2);
  });
}
