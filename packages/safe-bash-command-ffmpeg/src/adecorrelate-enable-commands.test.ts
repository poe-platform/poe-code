import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: [0, 1].map(channel => Float64Array.from({ length: 64 }, (_, i) =>
    (((i * 2 + channel) * 1751) % 45001 - 22000) / 32768))
});

async function run(filter: string, graph: boolean) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const chain = `asetnsamples=n=8:p=0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
    "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, 256);
  return bytes;
}

for (const graph of [false, true]) {
  // SHA-256 covers the complete PCM from native FFmpeg 7.0.2.
  for (const [filter, hash] of [
    ["asendcmd=c=0.004 adecorrelate@d enable 0,adecorrelate@d=stages=2:seed=42",
      "65b3676e5cfe9426d79ae6fb437dd3ca41f462d1c9a0ecca24d4dd9dab02f3d7"],
    ["asendcmd=c=0.004 adecorrelate@d enable 1,adecorrelate@d=stages=2:seed=42:enable=0",
      "c0d19d60a8c46ae220af2c7f8410926c190845b8f6e41b5d7f1c7b9e02fc609a"],
    ["adecorrelate@d=stages=2:seed=42:enable=lt(t\\,0.004)",
      "65b3676e5cfe9426d79ae6fb437dd3ca41f462d1c9a0ecca24d4dd9dab02f3d7"],
    ["adecorrelate@d=stages=2:seed=42:enable=gte(t\\,0.004)",
      "c0d19d60a8c46ae220af2c7f8410926c190845b8f6e41b5d7f1c7b9e02fc609a"],
    ["adecorrelate@d=stages=2:seed=42",
      "bcf229bcfeb80f7449696a09184a62055134214758a983dbb3c06fd019e7a926"],
    ["adecorrelate@d=stages=2:seed=42:enable=0",
      "18eef4bb3a89e8aa91746c32263e4f89b88fa9c1d40cd24f69ff2a2e47ea518b"]
  ] as const) {
    it(`matches native adecorrelate PCM three times: ${filter} (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        assert.equal(createHash("sha256").update(await run(filter, graph)).digest("hex"), hash);
      }
    });
  }

  for (const [commands, control] of [
    ["0.0035 adecorrelate@d enable 0", "enable='lt(t,0.004)'"],
    ["0.002 adecorrelate@d enable 0;0.004 adecorrelate@d enable invalid;0.006 adecorrelate@d enable 1",
      "enable='lt(n,2)+gte(n,6)'"],
    ["0.004 adecorrelate@other enable 0", "enable=1"],
    ["0.004 adecorrelate@d stages 1;0.004 adecorrelate@d seed 7", "enable=1"],
    ["0.004 adecorrelate enable 0", "enable='lt(n,4)'"],
    ["0.008 adecorrelate@d enable 0", "enable=1"]
  ]) {
    it(`preserves adecorrelate history and command targeting: ${commands} (graph=${graph})`, async () => {
      assert.deepEqual(
        await run(`asendcmd=c='${commands}',adecorrelate@d=stages=2:seed=42`, graph),
        await run(`adecorrelate@d=stages=2:seed=42:${control}`, graph)
      );
    });
  }

  it(`resets expression state only after accepted enable updates (graph=${graph})`, async () => {
    const expression = "lt(st(0,ld(0)+1),5)";
    assert.deepEqual(
      await run(`asendcmd=c='0.001 adecorrelate@d enable invalid;0.004 adecorrelate@d enable ${expression}',adecorrelate@d=stages=2:seed=42:enable='${expression}'`, graph),
      await run("adecorrelate@d=stages=2:seed=42:enable='lt(n,2)+between(n,4,5)'", graph)
    );
  });

  it(`routes commands to the named or first matching instance (graph=${graph})`, async () => {
    const filters = "adecorrelate@first=stages=2:seed=42,adecorrelate@d=stages=2:seed=7";
    assert.deepEqual(
      await run(`asendcmd=c='0.004 adecorrelate@d enable 0',${filters}`, graph),
      await run(`${filters}:enable='lt(n,4)'`, graph)
    );
    assert.deepEqual(
      await run(`asendcmd=c='0.004 adecorrelate enable 0',${filters}`, graph),
      await run("adecorrelate@first=stages=2:seed=42:enable='lt(n,4)',adecorrelate@d=stages=2:seed=7", graph)
    );
  });
}
