import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const header = Buffer.from("6361666600010000", "hex");
const description = Buffer.from("64657363000000000000002040bf4000000000006c70636d0000000000000004000000020000000100000010", "hex");
const data = Buffer.from("64617461000000000000000c000000000064ff38012cfe70", "hex");
for (const command of ["sync ffmpeg", "ffmpeg", "ffprobe"] as const) {
  it(`${command} reads fixed multi-frame CAF packets`, async () => {
    const input = Buffer.concat([header, description, data]);
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    volume.writeFileSync("/in.caf", input);
    const args = command === "ffprobe"
      ? ["-v", "error", "-show_streams", "-show_packets", "-of", "json", "/in.caf"]
      : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    if (command === "sync ffmpeg") {
      const run = () => evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(run(), "");
    } else {
      let stdout = "", stderr = "";
      const result = await (command === "ffmpeg" ? createFfmpegCommand() : createFfprobeCommand()).execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      if (command === "ffprobe") {
        const probe = JSON.parse(stdout);
        assert.equal(probe.streams[0].codec_name, "pcm_s16be");
        assert.equal(probe.streams[0].duration_ts, 4);
        assert.deepEqual(probe.packets.map(({ pos, size, duration }: { pos: string; size: string; duration: number }) => ({ pos, size, duration })), [
          { pos: "68", size: "4", duration: 2 },
          { pos: "72", size: "4", duration: 2 }
        ]);
      }
    }
    assert.deepEqual(volume.readFileSync("/out.raw"), command !== "ffprobe"
      ? Buffer.from("640038ff2c0170fe", "hex") : Buffer.from("keep"));
  });
}
