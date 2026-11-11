import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Checksums and encoded PCM hashes captured from native FFmpeg.
for (const graph of [false, true]) {
  for (const [filter, format, checksum, planes, pcmHash] of [
    ["extrastereo,ashowinfo", "flt", "93C905AE", "93C905AE", "c44590d8b0a9b6f0f97673e70d83ea0d82d0da2f02ed8be6160b0992c0375eae"],
    ["extrastereo,anull,ashowinfo", "flt", "93C905AE", "93C905AE", "c44590d8b0a9b6f0f97673e70d83ea0d82d0da2f02ed8be6160b0992c0375eae"],
    ["extrastereo,aformat=f=s16,ashowinfo", "s16", "5D0B03AE", "5D0B03AE", "c44590d8b0a9b6f0f97673e70d83ea0d82d0da2f02ed8be6160b0992c0375eae"],
    ["ashowinfo", "s16", "5FED02AE", "5FED02AE", "382da618eff12731107a9112675f01067f6ecdbc68c4095df2f6d10b307ce4b4"]
  ] as const) it(`${filter} preserves native intermediate frames and PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [new Float64Array(1024), new Float64Array(1024)];
    for (let i = 0; i < 1024; i += 512) {
      channels[0]![i] = 12000 / 32768;
      channels[1]![i + 2] = -8000 / 32768;
    }
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(stderr.trim().split("\n"), Array.from({ length: 2 }, (_, n) =>
      `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:512 checksum:${checksum} plane_checksums: [ ${planes} ]`));
    assert.equal(createHash("sha256").update(fs.readFileSync("/out.pcm") as Buffer).digest("hex"), pcmHash);
  });
}
