import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, -9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0, 7000, -7000, 7000, -7000, 0, 0, 0];

async function run(options: string, complex: boolean) {
  const input = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  const filter = `silenceremove=window=0:${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const complex of [false, true]) {
  for (const phase of ["start", "stop"]) {
    for (const threshold of ["0.1", "1/10", "(2+3)/50", "sqrt(0.01)", "-20dB", "-20dB/1"]) {
      it(`silenceremove ${phase}_threshold=${threshold} matches native PCM (complex=${complex})`, async () => {
        const { result, stderr, output } = await run(`${phase}_periods=1:${phase}_threshold=${threshold}`, complex);
        assert.equal(result.exitCode, 0, stderr);
        // Native FFmpeg: start removes four leading samples; stop ends after the first sound.
        const expected = phase === "start" ? samples.slice(4) : samples.slice(0, 6);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      });
    }
    for (const [threshold, status] of [["1/", 234], ["-1/10", 222], ["1/0", 222],
      ["0/0", 234], ["unknown", 234], ["0b1", 234]] as const) {
      it(`silenceremove rejects ${phase}_threshold=${threshold} preserving output (complex=${complex})`, async () => {
        const { result, stderr, output } = await run(`${phase}_periods=1:${phase}_threshold=${threshold}`, complex);
        assert.equal(result.exitCode, status, stderr);
        assert.ok(stderr.includes("silenceremove:"), stderr);
        assert.equal(output.toString(), "KEEP");
      });
    }
  }
}
