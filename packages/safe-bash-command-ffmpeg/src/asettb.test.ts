import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM and frame traces from FFmpeg 7.0.2, including the default-time-base control.
for (const complex of [false, true]) {
  for (const [filter, start, ticksPerSample] of [
    ["asettb=expr=1/1000", 0, 1 / 8],
    ["asettb=intb", 0, 1],
    ["asettb", 0, 1],
    ["asettb=1/1000,asetpts=PTS+100,atrim=start=0.15", 400, 1 / 8],
    ["asetpts=PTS+800,atrim=start=0.15", 400, 1],
    ["asettb=1/1000,asetpts=PTS+0.1/TB,atrim=start_pts=1200", 400, 1 / 8],
    ["asettb=1/1000,asettb=1/sr", 0, 1],
    ["asettb=tb=intb*8", 0, 1 / 8],
    ["asettb=1/1000,aselect='eq(pts,n*64)*eq(TB,0.001)'", 0, 1 / 8],
    ["asettb=1/1000,atrim=start_sample=397,asetpts=PTS+100,atrim=start_sample=3", 400, 1 / 8]
  ] as const) {
    it(`${filter} preserves PCM and rescales timestamps (${complex ? "complex" : "simple"})`, async () => {
      const samples = Float64Array.from({ length: 4707 }, (_, i) => (i - 2000) / 32768);
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [samples] })),
        "/out.raw": "KEEP"
      });
      let stderr = "";
      const chain = `${filter},ashowinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
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
      assert.equal(output.length, (4707 - start) * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), start === 0
        ? "3b1a86d3d5b3270120685f795fd3ea9b42d3298f90a6c90f8882988f3c57ef67"
        : "2acb7a537a45236782ebed1485e6b18e80f630c8479a255cfea2a8efeca08252");
      const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
        const fields = line.split(" ");
        return ["n:", "pts:", "nb_samples:", "pts_time:"].map(prefix =>
          Number(fields.find(field => field.startsWith(prefix))!.slice(prefix.length)));
      });
      assert.deepEqual(frames, Array.from({ length: 10 }, (_, n) => {
        const offset = n === 0 ? start : n * 512;
        const pts = offset + (start ? 800 : 0);
        return [n, pts * ticksPerSample, Math.min(4707, (n + 1) * 512) - offset, pts / 8000];
      }));
    });
  }
}

for (const expression of ["0", "-1/1000", "1/0", "unknown", "expr=", "other=1/1000"]) {
  it(`asettb=${expression} preserves the destination on invalid input`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(16), "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asettb=${expression}`, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("asettb"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
