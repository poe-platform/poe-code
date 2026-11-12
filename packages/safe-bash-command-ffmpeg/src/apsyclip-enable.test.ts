import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean) {
  const fs = createMemoryFileSystem();
  const input = Buffer.alloc(515 * 2);
  for (let i = 0; i < 515; i++) input.writeInt16LE((i * 557) % 14001 - 7000, i * 2);
  await fs.writeFile("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, input.length);
  return bytes;
}

for (const graph of [false, true]) {
  // Complete PCM references from native FFmpeg 7.0.2, including the partial final hop.
  for (const [options, hash] of [
    [":diff=1:enable=0", "cf2ed9698023fde697a5b4708e01463f4fe3e2ba837402eb4a400da1d696cf3f"],
    [":diff=1:enable=1", "13fdf35032a792035c873733b9aa46f22820b75a199a83a40a21f6f3e1ab240f"],
    [":diff=1:enable=gte(t\\,0.032)", "d3f251dd7f2cb8d92e755f706c0b9509e09c23003eec6532e6f041c58fbbd615"],
    ["", "cf2ed9698023fde697a5b4708e01463f4fe3e2ba837402eb4a400da1d696cf3f"],
    [":diff=1", "13fdf35032a792035c873733b9aa46f22820b75a199a83a40a21f6f3e1ab240f"]
  ]) {
    it(`matches native apsyclip PCM three times: ${options} (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const bytes = await run(`asetnsamples=n=64:p=0,apsyclip@c=iterations=1${options}`, graph);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
      }
    });
  }

  for (const filter of [
    "apsyclip=iterations=1:diff=1:enable=gte(t\\,0.032)",
    "asetnsamples=n=100:p=0,apsyclip=iterations=1:diff=1:enable=gte(n\\,4)",
    "asetnsamples=n=256:p=0,apsyclip=iterations=1:diff=1:enable='st(0,ld(0)+1);gte(ld(0),5)'",
    "asetnsamples=n=100:p=0,asetpts=PTS+0.5/TB,apsyclip=iterations=1:diff=1:enable=gte(t\\,0.532)"
  ]) {
    it(`evaluates apsyclip enable once per processing hop with input PTS: ${filter} (graph=${graph})`, async () => {
      assert.equal(createHash("sha256").update(await run(filter, graph)).digest("hex"),
        "d3f251dd7f2cb8d92e755f706c0b9509e09c23003eec6532e6f041c58fbbd615");
    });
  }

  it(`bypasses difference and output gain while retaining input gain and delay (graph=${graph})`, async () => {
    assert.deepEqual(
      await run("apsyclip=iterations=1:level_in=2:level_out=3:level=1:clip=0.5:diff=1:enable=0", graph),
      await run("apsyclip=iterations=1:level_in=2", graph)
    );
  });
}
