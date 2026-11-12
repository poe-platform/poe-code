import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM and PTS observed with native FFmpeg 7.0.2 at 1000 Hz.
for (const complex of [false, true]) {
  for (const [filter, keep, timestamp] of [
    ["asetpts=NAN,asettb=1/100,aselect=isnan(pts)", false, undefined],
    ["asetpts=NAN,asettb=1/100,aselect=lt(pts\\,0)", true, "-922337203685477581"],
    ["asetpts=NAN,aselect=isnan(pts)", true, "NOPTS"],
    ["asettb=1/100,aselect=isnan(pts)", false, undefined],
    ["asetpts=NAN,asettb=intb,aselect=isnan(pts)", true, "NOPTS"],
    ["asetpts=NAN,asettb=1/10000,aselect=isnan(pts)", true, "NOPTS"],
    ["asetpts=NAN,asettb=3/1000", true, "-3074457345618258602"],
    ["asetpts=NAN,asettb=1/100,asettb=1/1000", true, "NOPTS"]
  ] as const) {
    it(`${filter} matches native missing-PTS rescaling (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE(101 + i, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Buffer[] = [];
      let stderr = "";
      const chain = `${filter},ashowinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
      assert.deepEqual(Buffer.concat(output), keep ? input : Buffer.alloc(0));
      const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.deepEqual(frames.map(line => line.split(" pts:")[1]!.split(" ")[0]),
        timestamp === undefined ? [] : [timestamp]);
    });
  }
}
