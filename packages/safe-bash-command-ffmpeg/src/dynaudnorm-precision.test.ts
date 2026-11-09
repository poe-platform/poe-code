import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference: the gain at sample 701 must stay below
// the PCM16 half-step (-10731.481737147724, rather than -10731.5).
for (const [options, expectedSample, expectedPcmHash] of [
  ["f=10:g=3:p=0.5", -0.3274988323104164, "cd38e438d090cc2ef6a465f9ebe2873a41c6a26bc7ab14d29351ca1448040134"],
  ["f=10:g=3:p=0.5:m=1", -0.28657732049212414, "2caccfd7df0407a614ff14ce12bbb5ede3b3e483e9950287193a9a50470574e0"],
  ["f=10:g=3:p=0.5:m=100", -0.3279720083649322, "2082ea7254a758a11f75f5e67cfe8ff31f2f07764121c0a93a9dbb392185ba5a"],
  ["f=10:g=3:p=0", 0, "277133e770229f00b0790b55e7d4ef5c1ec4ca589312efa5d99a3bf13f5eb32c"],
  ["f=100:g=5:p=0.95", -0.46091364894038495, "0c15bfea243184dc8fc158886b9688e1b483ec18dc0842b299d93108c8995a14"]
] as const) for (const graph of [false, true]) for (const format of ["f64le", "s16le"]) {
  it(`dynaudnorm=${options} preserves gain precision in ${format} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    const samples = Float64Array.from({ length: 8137 }, (_, i) =>
      (i % 2 ? -1 : 1) * [1000, 5600, 200, 24000, 15000, 2000, 4000][Math.floor(i / 149) % 7]! / 32768);
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
    const filter = `dynaudnorm=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, samples.length * (format === "f64le" ? 8 : 2));
    if (format === "f64le") {
      const actual = output.readDoubleLE(701 * 8);
      assert.ok(Math.abs(actual - expectedSample) < 1e-14, `sample 701: ${actual}`);
    } else {
      assert.equal(createHash("sha256").update(output).digest("hex"), expectedPcmHash);
    }
  });
}
