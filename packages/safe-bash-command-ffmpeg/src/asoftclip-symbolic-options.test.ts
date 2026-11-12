import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes for the reported 32-sample mono PCM16 input.
for (const [symbolic, numeric, hash] of [
  ["oversample=max", "oversample=64", "583a8af26e8755b641df5bbbd7d61593772acc356430639d1a67c3313e33249e"],
  ["oversample=default", "oversample=1", "3a8f003ffbc2b6a32bd9f4927728bd7c716a92c3c9faf0c4aac1c63b9fb25e89"],
  ["threshold=max", "threshold=1", "3a8f003ffbc2b6a32bd9f4927728bd7c716a92c3c9faf0c4aac1c63b9fb25e89"],
  ["param=default", "param=1", "3a8f003ffbc2b6a32bd9f4927728bd7c716a92c3c9faf0c4aac1c63b9fb25e89"],
  ["output=min", "output=0.000001", "f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b"],
  ["type=default", "type=0", "3a8f003ffbc2b6a32bd9f4927728bd7c716a92c3c9faf0c4aac1c63b9fb25e89"]
]) for (const graph of [false, true]) {
  it(`asoftclip ${symbolic} and its numeric control match native PCM (graph=${graph})`, async () => {
    for (const option of [numeric, symbolic]) {
      const { result, stderr, pcm } = await run(`asoftclip=${option}`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(pcm.length, 64);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    }
  });
}

for (const [key, min, max] of [
  ["threshold", 0.000001, 1], ["output", 0.000001, 16],
  ["param", 0.01, 3], ["oversample", 1, 64]
] as const) for (const [symbol, numeric] of [["min", min], ["max", max], ["default", 1], ["(min+max)/2", (min + max) / 2]] as const) {
  for (const graph of [false, true]) {
    it(`asoftclip ${key}=${symbol} matches its numeric value in static and timed options (graph=${graph})`, async () => {
      for (const timed of [false, true]) {
        const filter = (value: string | number) => timed
          ? `asetnsamples=8:0,asendcmd=c='0.001 asoftclip@x ${key} ${value}',asoftclip@x=threshold=0.5:output=0.5:param=2:oversample=2`
          : `asoftclip=${key}=${value}`;
        const control = await run(filter(numeric), graph);
        const actual = await run(filter(symbol), graph);
        assert.equal(control.result.exitCode, 0, control.stderr);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.pcm, control.pcm);
      }
    });
  }
  if (symbol !== "min" && symbol !== "max") continue;
  it(`asoftclip ${key} rejects expressions beyond ${symbol} without replacing output`, async () => {
    const { result, stderr, pcm, volume } = await run(`asoftclip=${key}=${symbol}${symbol === "min" ? "/2" : "+1"}`, false, "/out.pcm");
    assert.equal(result.exitCode, 222, stderr);
    assert.equal(pcm.length, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

it("asoftclip accepts symbolic values in positional options", async () => {
  const actual = await run("asoftclip=default:max:default:min:max");
  const control = await run("asoftclip=0:1:1:0.01:64");
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(control.result.exitCode, 0, control.stderr);
  assert.deepEqual(actual.pcm, control.pcm);
});

async function run(filter: string, graph = false, output = "pipe:1") {
  const input = Buffer.alloc(64);
  for (let i = 0; i < 32; i++) input.writeInt16LE((i * 1751) % 42001 - 21000, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.pcm": "keep" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: Buffer.concat(chunks), volume };
}
