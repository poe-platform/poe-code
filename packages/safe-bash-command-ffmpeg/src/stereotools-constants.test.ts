import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95];
// Captured from native FFmpeg; each constant expression also checked against its literal equivalent.
const cases: [string, readonly number[] | undefined][] = [
  ["stereotools=level_in=min", [16, -31, 47, 19, -8, 14, 512, -500, 0, -1, 1, 1]],
  ["stereotools=level_in=max", [32767, -32768, 32767, 32767, -32768, 32767, 32767, -32768, 1088, -2112, 6016, 6080]],
  ["stereotools=level_in=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=level_in=(min+max)/2", [32008, -32768, 32767, 32767, -16868, 29095, 32767, -32768, 544, -1056, 3009, 3041]],
  ["stereotools=level_out=min", [16, -31, 47, 19, -8, 14, 512, -500, 0, -1, 1, 1]],
  ["stereotools=level_out=max", [32767, -32768, 32767, 32767, -32768, 32767, 32767, -32768, 1088, -2112, 6016, 6080]],
  ["stereotools=level_out=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=level_out=(min+max)/2", [32008, -32768, 32767, 32767, -16868, 29095, 32767, -32768, 544, -1056, 3009, 3041]],
  ["stereotools=mlev=min", [1492, -1508, 916, -850, -715, 721, 32389, -32378, 25, -25, 1, 2]],
  ["stereotools=mlev=max", [-30500, -32768, 32767, 32767, 11506, 12942, 32767, -7840, -487, -537, 6048, 6048]],
  ["stereotools=mlev=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=mlev=(min+max)/2", [-14504, -17504, 32767, 32767, 5395, 6831, 32767, -20109, -231, -281, 3024, 3025]],
  ["stereotools=slev=min", [-477, -523, 2131, 2103, 180, 202, 889, -122, -8, -8, 94, 95]],
  ["stereotools=slev=max", [32767, -32768, 32767, -32768, -32768, 32767, 32767, -32768, 1592, -1608, 62, 126]],
  ["stereotools=slev=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=slev=(min+max)/2", [32767, -32768, 30380, -26146, -22791, 23173, 32767, -32768, 792, -808, 78, 111]],
  ["stereotools=balance_in=min", [1000, 0, 3000, 0, -527, 0, 32767, 0, 17, 0, 94, 0]],
  ["stereotools=balance_in=max", [0, -2000, 0, 1234, 0, 909, 0, -32000, 0, -33, 0, 95]],
  ["stereotools=balance_in=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=balance_in=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=balance_out=min", [1000, 0, 3000, 0, -527, 0, 32767, 0, 17, 0, 94, 0]],
  ["stereotools=balance_out=max", [0, -2000, 0, 1234, 0, 909, 0, -32000, 0, -33, 0, 95]],
  ["stereotools=balance_out=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=balance_out=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=mpan=min", [1000, -1500, 3000, -883, -527, 718, 32767, -32384, 17, -25, 94, 0]],
  ["stereotools=mpan=max", [1500, -2000, 883, 1234, -718, 909, 32384, -32000, 25, -33, 0, 95]],
  ["stereotools=mpan=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=mpan=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=sbal=min", [1000, -500, 3000, 2117, -527, 191, 32767, 384, 17, -8, 94, 94]],
  ["stereotools=sbal=max", [-500, -2000, 2117, 1234, 191, 909, 384, -32000, -8, -33, 94, 95]],
  ["stereotools=sbal=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=sbal=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=base=min", [-500, -500, 2117, 2117, 191, 191, 384, 384, -8, -8, 94, 94]],
  ["stereotools=base=max", [4000, -5000, 4766, -532, -1963, 2345, 32767, -32768, 67, -83, 93, 96]],
  ["stereotools=base=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=base=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=delay=min", [0, -2000, 0, 1234, 0, 909, 0, -32000, 0, -33, 0, 95]],
  ["stereotools=delay=max", [1000, 0, 3000, 0, -527, 0, 32767, 0, 17, 0, 94, 0]],
  ["stereotools=delay=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=delay=(min+max)/2", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=softclip=1:sclevel=min", [1273, -2543, 3809, 1570, -671, 1157, 32767, -32273, 22, -42, 120, 121]],
  ["stereotools=softclip=1:sclevel=max", [26330, -29569, 30694, 27529, -21299, 25714, 32767, -32763, 1088, -2107, 5865, 5924]],
  ["stereotools=softclip=1:sclevel=default", [1273, -2543, 3809, 1570, -671, 1157, 32767, -32273, 22, -42, 120, 121]],
  ["stereotools=softclip=1:sclevel=(min+max)/2", [21026, -26558, 28686, 22959, -14411, 20089, 32767, -32758, 553, -1074, 3039, 3071]],
  ["stereotools=phase=min", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=phase=max", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=phase=default", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["stereotools=phase=(min+max)/2", [-1000, 2000, -3000, -1234, 527, -909, -32767, 32000, -17, 33, -94, -95]]
];
for (const key of ["level_in", "level_out", "mlev", "slev", "balance_in", "balance_out", "mpan", "sbal", "base", "delay", "sclevel", "phase"]) {
  for (const value of ["min-1", "max+1", "default/0", "unknown"]) {
    cases.push([`stereotools=${key}=${value}`, undefined]);
  }
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo option constants (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (!expected) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("stereotools"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
    });
  }
}
