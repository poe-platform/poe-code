import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 1536 }, (_, i) => ((i * 421) % 12000 - 6000) / 32768)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-v", "info", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 hashes cover every output sample, including resampler rounding.
for (const key of ["osf", "out_sample_fmt"]) {
  for (const [argument, format, bytes, hash] of [
    [`8000:${key}=s16`, "s16", 3072, "e874d3b9256262c88d02c2a123f392fbc90502de73dcca88ad983c1747264c86"],
    [`${key}=dbl`, "dbl", 3072, "e874d3b9256262c88d02c2a123f392fbc90502de73dcca88ad983c1747264c86"],
    [`16000:${key}=fltp`, "fltp", 6144, "017d80035cefcadffa4ff8847b979c718cb659d28462e9162acafe9c2ed0575a"],
    [`${key}=fltp:osr=16000`, "fltp", 6144, "017d80035cefcadffa4ff8847b979c718cb659d28462e9162acafe9c2ed0575a"]
  ] as const) {
    for (const graph of [false, true]) it(`aresample=${argument} (${graph ? "graph" : "simple"})`, async () => {
      const result = await convert(`aresample=${argument},ashowinfo`, graph);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, bytes);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), hash);
      assert.ok(result.stderr.includes(`fmt:${format} channels:1`), result.stderr);
    });
  }
  for (const value of ["", "bad", "s16|flt", "s16=1"]) {
    it(`rejects ${key}=${value} without replacing output`, async () => {
      const result = await convert(`aresample=8000:${key}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output.toString(), "KEEP");
      assert.ok(result.stderr.includes("sample format"), result.stderr);
    });
  }
}

it("allows explicit sample conversion with automatic conversion disabled", async () => {
  const result = await convert("aresample=osf=flt,aresample=osf=s16", false, ["-noauto_conversion_filters"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(createHash("sha256").update(result.output).digest("hex"), "e874d3b9256262c88d02c2a123f392fbc90502de73dcca88ad983c1747264c86");
});

for (const format of ["u8", "u8p", "s16", "s16p", "s32", "s32p", "s64", "s64p", "flt", "fltp", "dbl", "dblp"]) {
  it(`preserves ${format} samples and format through the next filter`, async () => {
    const result = await convert(`aresample=out_sample_fmt=${format},ashowinfo`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stderr.includes(`fmt:${format} channels:1`), result.stderr);
    const expected = Buffer.alloc(3072);
    for (let i = 0; i < 1536; i++) {
      const sample = (i * 421) % 12000 - 6000;
      expected.writeInt16LE(format === "u8" || format === "u8p" ? Math.floor(sample / 256) * 256 : sample, i * 2);
    }
    assert.deepEqual(result.output, expected);
  });
}

it("negotiates the output rate with only a sample-format option", async () => {
  const result = await convert("aresample=osf=fltp", false, ["-ar", "16000"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.length, 6144);
  assert.equal(createHash("sha256").update(result.output).digest("hex"), "017d80035cefcadffa4ff8847b979c718cb659d28462e9162acafe9c2ed0575a");
});
