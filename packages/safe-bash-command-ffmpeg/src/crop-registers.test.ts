import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 36 }, (_, i) => i));

// Three 4x3 gray frames at 2 fps. Coordinates evaluate in x, y, x order,
// with independent registers per expression, initialized before the first frame.
for (const [filter, expected] of [
  ["crop=1:1:0:'st(0,ld(0)+1)'", "041420"],
  ["crop=1:1:0:n+1", "041420"],
  ["crop=2:2:ld(0):0", "000104050c0d101118191c1d"],
  ["crop=2:2:0:0", "000104050c0d101118191c1d"],
  ["crop=1:1:'mod(st(0,ld(0)+1),4)':0", "020c1a"],
  ["crop=1:1:'st(0,ld(0)+1)':'st(0,ld(0)+1)'", "061723"],
  ["crop=1:1:'st(0,2)':ld(0)", "020e1a"],
  ["crop=1:1:y:'st(0,ld(0)+1)'", "051623"],
  ["crop=1:1:0:'if(eq(n,0),st(0,1),ld(0))'", "04101c"],
  ["crop=1:1:0:'if(eq(n,0),st(0,1/0),ld(0))'", "081420"],
  ["crop=1:1:0:'st(0,-1/0)'", "000c18"],
  ["crop=4:3:'st(0,9)':0,crop=1:1:ld(0):ld(0)", "000c18"],
  ["sendcmd=c='0.5 crop x 0',crop=1:1:0:'st(0,ld(0)+1)'", "041020"]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves crop registers (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const command = createFfmpegCommand();
      // Reusing a command must not retain expression state from an earlier run.
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await command.execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
            "-video_size", "4x3", "-framerate", "2", "-i", "/in.raw", ...(graph
              ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
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
        assert.equal(stderr, "");
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      }
    });
  }
}
