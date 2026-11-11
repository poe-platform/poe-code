import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references, independently checked with FFmpeg 9.0.1.
for (const graph of [false, true]) {
  for (const [filter, format, checksum, planes, pcmHash] of [
    ["compensationdelay=m=1,ashowinfo", "dblp", "0EDF0354", "40160186 6D5201CE", "9cdb5c909dab16fda9d0531cca8bf32bcd8ce3179d511dae93262754e9ff6f6b"],
    ["compensationdelay=m=1,anull,ashowinfo", "dblp", "0EDF0354", "40160186 6D5201CE", "9cdb5c909dab16fda9d0531cca8bf32bcd8ce3179d511dae93262754e9ff6f6b"],
    ["compensationdelay=m=1,aformat=f=s16,ashowinfo", "s16", "695602AE", "695602AE", "9cdb5c909dab16fda9d0531cca8bf32bcd8ce3179d511dae93262754e9ff6f6b"],
    ["ashowinfo", "s16", "5FED02AE", "5FED02AE", "a4e5f98067ac0eed97533807a535a40b208e64655a975df10bbabf234e2aa56c"]
  ] as const) it(`${filter} preserves native intermediate frames and PCM (${graph ? "graph" : "simple"})`, async () => {
    const channels = [new Float64Array(2048), new Float64Array(2048)];
    for (let i = 0; i < 2048; i += 512) {
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
    assert.deepEqual(stderr.trim().split("\n"), Array.from({ length: 4 }, (_, n) =>
      `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:512 checksum:${checksum} plane_checksums: [ ${planes} ]`));
    assert.equal(createHash("sha256").update(fs.readFileSync("/out.pcm") as Buffer).digest("hex"), pcmHash);
  });
}
