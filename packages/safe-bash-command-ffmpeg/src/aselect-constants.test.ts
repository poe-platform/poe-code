import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// The reported FFmpeg 7.0.2 fixture uses ten PCM16 samples in three-sample frames.
for (const complex of [false, true]) {
  for (const expression of [
    "eq(PI,PI)", "eq(E,E)", "eq(PHI,PHI)", "PI", "E", "PHI", "1",
    "eq(PI,3.141592653589793)", "eq(E,2.718281828459045)", "eq(PHI,1.618033988749895)",
    "eq(PI,3)", "eq(E,2)", "eq(PHI,1)", "pi", "phi", "PI_unknown"
  ]) {
    it(`aselect evaluates ${expression} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE(101 + 13 * i, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,aselect='${expression}'`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          "-f", "s16le", "/out.dat"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (["pi", "phi", "PI_unknown"].includes(expression)) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("aselect: invalid or unsupported expression"), stderr);
        assert.equal(volume.readFileSync("/out.dat", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const dropsAll = ["eq(PI,3)", "eq(E,2)", "eq(PHI,1)"].includes(expression);
        assert.deepEqual(volume.readFileSync("/out.dat"), dropsAll ? Buffer.alloc(0) : input);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
