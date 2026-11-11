import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = "0724415e7b98b5d2ef0c294663809dba";
const white = "ff24415e7b98b5d2ef0c294663809dba";
const moved = "0724ff5e7b98b5d2ef0c294663809dba";
const red = "4c24415e7b98b5d2ef0c294663809dba";
const input = Buffer.from(frame.repeat(3), "hex");
const box = "x=0:y=0:w=1:h=1:t=fill:c=white";

for (const [filter, expected] of [
  [`drawbox=${box}`, white.repeat(3)],
  [`sendcmd=c='0.5 drawbox x 2',drawbox=${box}`, white + moved.repeat(2)],
  [`sendcmd=c='0.5 drawbox color red',drawbox=${box}`, white + red.repeat(2)],
  [`sendcmd=c='0.51 drawbox x 2',drawbox=${box}`, white.repeat(2) + moved],
  [`sendcmd=c='0.5 drawbox@one c red',drawbox@one=${box}`, white + red.repeat(2)],
  [`sendcmd=c='0.5 drawbox@other x 2',drawbox@one=${box}`, white.repeat(3)],
  [`sendcmd=c='0.5 drawbox y 1',drawbox=${box}`, white + "0724415eff98b5d2ef0c294663809dba".repeat(2)],
  [`sendcmd=c='0.5 drawbox x iw/2;1 drawbox x 0',drawbox=${box}`, white + moved + white],
  [`sendcmd=c='0.5 drawbox x invalid;1 drawbox color invalid',drawbox=${box}`, white.repeat(3)],
  [`sendcmd=c='2 drawbox x 2',drawbox=${box}`, white.repeat(3)],
  [`sendcmd=c='0.5 drawbox x 2',drawbox@one=${box},drawbox@two=${box}`, white + "ff24ff5e7b98b5d2ef0c294663809dba".repeat(2)],
  [`sendcmd=c='0.5 drawbox@two x 2',drawbox@one=${box},drawbox@two=${box}`, white + "ff24ff5e7b98b5d2ef0c294663809dba".repeat(2)],
  [`sendcmd=c='1 drawbox x 0',sendcmd=c='0.5 drawbox x 2',drawbox=${box}`, white + moved + white],
  [`sendcmd=c='0.5 drawbox color red;1 drawbox color invalid',drawbox=${box}`, white + red.repeat(2)],
  [`sendcmd=c='0.5 drawbox x 2;1 drawbox x invalid',drawbox=${box}`, white + moved.repeat(2)],
  [`drawbox=${box},sendcmd=c='0.5 drawbox x 2'`, white.repeat(3)]
] as const) {
  for (const graph of [false, true]) {
    it(`applies drawbox commands (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const command = createFfmpegCommand();
      // Reusing a command must not retain expression state from an earlier run.
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await command.execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
            "-video_size", "4x4", "-framerate", "2", "-i", "/in.raw", ...(graph
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
