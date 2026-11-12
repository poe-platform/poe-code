import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 11 }, (_, i) => 101 + i);
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts=PTS-STARTPTS,aselect=isnan(pts)", samples.slice(0, 4)],
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts=PTS-STARTPTS,aselect='eq(pts,0)'", samples.slice(4, 8)],
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts=PTS-STARTPTS,aselect='eq(pts,4)'", samples.slice(8)],
    ["asetpts='if(eq(N,0),NAN,PTS)',aselect=isnan(pts)", samples.slice(0, 4)],
    ["asetpts=PTS-STARTPTS,aselect='eq(pts,0)'", samples.slice(0, 4)],
    ["asetpts='if(lt(N,8),NAN,PTS)',asetpts=PTS-STARTPTS,aselect='eq(pts,0)'", samples.slice(8)],
    ["asetpts=NAN,asetpts=PTS-STARTPTS,aselect=isnan(pts)", samples],
    ["asetpts='if(eq(N,4),NAN,PTS)',asetpts=PTS-STARTPTS,aselect='eq(pts,8)'", samples.slice(8)],
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts=PTS-STARTT/TB,aselect='eq(pts,0)'", samples.slice(4, 8)],
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts='if(isnan(STARTPTS),0,PTS-STARTPTS)',aselect='eq(n,0)*eq(pts,0)'", samples.slice(0, 4)],
    ["asetpts='if(eq(N,0),NAN,PTS)',asetpts='if(isnan(STARTT),0,PTS-STARTT/TB)',aselect='eq(n,0)*eq(pts,0)'", samples.slice(0, 4)]
  ] as const) {
    it(`initializes asetpts from the first known timestamp: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Buffer[] = [];
      let stderr = "";
      const chain = `asetnsamples=n=4:p=0,${filter}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const bytes = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
    });
  }
}
