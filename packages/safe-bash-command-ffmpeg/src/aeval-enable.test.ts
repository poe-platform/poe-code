import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [options, exitCode] of [
    ["enable=0", 176], ["enable=gt(t\\,0)", 176],
    ["c=mono:enable=0", 176], ["c=same:enable=0", 0], ["enable=1", 0]
  ] as const) {
    it(`handles mono aeval layout on bypass (${options}, ${complex ? "graph" : "simple"})`, async () => {
      const samples = [100, 200, 300, 400, 500, 600, 700, 800];
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stderr = "";
      const stdout: Buffer[] = [];
      const filter = `aeval=0:${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      const output = Buffer.concat(stdout);
      if (exitCode) {
        assert.equal(output.length, 0);
        assert.match(stderr, /Channel layout change is not supported/);
      } else {
        assert.equal(output.length, samples.length * 2);
        assert.deepEqual(samples.map((_, i) => output.readInt16LE(i * 2)),
          options === "enable=1" ? samples.map(() => 0) : samples);
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}

for (const complex of [false, true]) {
  for (const [enable, enabled] of [["0", false], ["1", true], ["-1", true],
    ["0.1", false], ["lt(n\\,1)", true], ["gt(t\\,0)", false]] as const) {
    it(`aeval enable=${enable} preserves stereo samples when bypassed (${complex ? "graph" : "simple"})`, async () => {
      const samples = [110, -550, 220, -660, 330, -770, 440, -880];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const filter = `aeval=0-val(ch):c=same:enable=${enable}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, input.length);
      assert.deepEqual(samples.map((_, i) => output.readInt16LE(i * 2)),
        samples.map(sample => enabled ? -sample : sample));
    });
  }
}
