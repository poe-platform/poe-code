import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const left = [1, 3, -3, 301, 12001, 30000, -30000, 32767];
const right = [4, -4, 6, 711, -31999, 30000, -30000, -32768];

for (const [equation, expected] of [
  ["c0=c1", right],
  ["c+0=c1", right],
  ["c-0=c1", right],
  ["c 0=c1", right],
  ["c0=c+1", right],
  ["c0=c-0", left],
  ["c0=c 1", right],
  ["c +00=c +01", right],
  ["c -00=c -00", left],
  ["c\t+0=c\t+1", right],
  ["c+0=1e+0*c+1", right],
  ["c 0=1 * c +1", right],
  ["c+0<2*c+1", right],
  ["c0=0.5*c+0+0.5*c+1", [3, 0, 2, 506, -9999, 30000, -30000, 0]],
  ["c0=0.25*c+0-0.25*c+1", [-1, 2, -2, -102, 11000, 0, 0, 16384]],
  ["c-1=c0", null],
  ["c0=c-1", null],
  ["c0=c -1", null],
  ["c0=c+64", null],
  ["c+1=c0", null],
  ["c+=c0", null],
  ["c0=c+", null],
  ["c0=c + 1", null],
  ["c0=c++1", null],
  ["c0=c0x1", null],
  ["c0=c1.0", null],
  ["c0=c+0+c-0", null],
  ["c+0=c0|c-0=c1", null]
] as const) {
  for (const complex of [false, true]) {
    it(`parses decimal pan channel indices (${complex ? "graph" : "simple"}): ${equation}`, async () => {
      const input = Buffer.alloc(left.length * 4);
      for (let index = 0; index < left.length; index++) {
        input.writeInt16LE(left[index]!, index * 4);
        input.writeInt16LE(right[index]!, index * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const filter = `pan=mono|${equation}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
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
      if (expected === null) {
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.existsSync("/out.raw"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}
