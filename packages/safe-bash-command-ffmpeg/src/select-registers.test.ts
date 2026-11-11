import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "0d141b222930373e454c535a";

for (const complex of [false, true]) {
  for (const [filter, expected, pts] of [
    ["select='eq(st(0,ld(0)+1),2)'", "2930373e", [1]],
    ["select='eq(n,1)'", "2930373e", [1]],
    ["reverse,select='eq(st(0,ld(0)+1),2)'", "2930373e", [1]],
    ["select='eq(ld(0),0)'", input, [0, 1, 2]],
    ["select='st(0,ld(0)+1);st(9,ld(9)+2);eq(ld(0),3)*eq(ld(9),6)'", "454c535a", [2]],
    ["select='gt(st(0,ld(0)+1),1)',select='eq(ld(0),0)'", "2930373e454c535a", [1, 2]],
    ["reverse,trim=end_frame=0,select='st(0,1)'", "", []],
    ["select='st(0,1);unknown'", null, []],
    ["reverse,trim=end_frame=0,select='st(0,1);unknown'", null, []]
  ] as const) {
    it(`select retains local registers: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const command = createFfmpegCommand();
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
        const output: Uint8Array[] = [];
        let stderr = "";
        const chain = `${filter},showinfo`;
        const result = await command.execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:v]${chain}[o]`, "-map", "[o]"] : ["-vf", chain]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (expected === null) {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("select: invalid or unsupported expression"), stderr);
          assert.equal(Buffer.concat(output).length, 0);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(Buffer.concat(output).toString("hex"), expected);
          const timestamps = stderr.split("\n").filter(line => line.includes("pts_time:"))
            .map(line => Number(line.split("pts:")[1]!.trim().split(" ")[0]));
          assert.deepEqual(timestamps, pts);
        }
        assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
      }
    });
  }
}
