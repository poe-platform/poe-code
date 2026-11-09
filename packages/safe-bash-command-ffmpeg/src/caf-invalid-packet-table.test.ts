import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg, evalSyncFfprobe } from "./index.js";

// Original PCM CAF fixtures: eight big-endian samples, 101 through 108.
const header = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010", "hex");
const data = Buffer.from("6461746100000000000000140000000000650066006700680069006a006b006c", "hex");
const short = Buffer.from("70616b7400000000000000080000000000000000", "hex");
const negative = Buffer.from("70616b740000000000000018ffffffffffffffff00000000000000040000000200000002", "hex");
const zero = Buffer.from("70616b740000000000000018000000000000000000000000000000000000000000000000", "hex");

for (const [name, table, diagnostic] of [
  ["eight-byte header", short, "Invalid CAF packet table header"],
  ["empty header", Buffer.from("70616b740000000000000000", "hex"), "Invalid CAF packet table header"],
  ["23-byte header", Buffer.concat([Buffer.from("70616b740000000000000017", "hex"), Buffer.alloc(23)]), "Invalid CAF packet table header"],
  ["negative packet count", negative, "Invalid CAF packet count"],
  ["invalid table followed by valid table", Buffer.concat([short, zero]), "Invalid CAF packet table header"],
  ["zero packet count", zero, undefined],
  ["absent packet table", Buffer.alloc(0), undefined]
] as const) {
  for (const command of ["sync ffmpeg", "ffmpeg", "sync ffprobe", "ffprobe"] as const) {
    it(`${command} validates CAF ${name} before overwriting output`, async () => {
      const input = Buffer.concat([header, table, data]);
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.caf", input);
      const probe = command.endsWith("ffprobe");
      const args = probe
        ? ["-v", "error", "-show_streams", "-of", "json", "/in.caf"]
        : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      let stdout = "", stderr = "";
      if (command === "sync ffmpeg") {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), diagnostic ? undefined : "");
      } else if (command === "sync ffprobe") {
        const result = evalSyncFfprobe(input, [...args.slice(0, -1), "pipe:0"]);
        if (diagnostic) assert.equal(result, undefined);
        else stdout = result!;
      } else {
        const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
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
        if (diagnostic) {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes(diagnostic), stderr);
        } else assert.equal(result.exitCode, 0, stderr);
      }
      if (probe && !diagnostic) assert.equal(JSON.parse(stdout).streams[0].codec_name, "pcm_s16be");
      assert.deepEqual(volume.readFileSync("/out.raw"), !diagnostic && !probe
        ? Buffer.from("650066006700680069006a006b006c00", "hex") : Buffer.from("KEEP"));
    });
  }
}
