import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg, createFfprobeCommand, evalSyncFfprobe } from "./index.js";

const input = readFileSync(new URL("./fixtures/data-first.wav", import.meta.url));
// Native FFmpeg accepts the final three samples from a file, but rejects a pipe
// before opening its output: found no 'fmt ' tag before the 'data' tag.
for (const target of ["/in.wav", "pipe:0", "-"]) {
  for (const probe of [undefined, ["-show_streams"], ["-show_packets"], ["-show_packets", "-show_data"], ["-f", "wav", "-show_packets"]]) {
    it(`handles data before format through ${target}: ${probe?.join(" ") ?? "decode"}`, async () => {
      const pipe = target !== "/in.wav";
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
      const args = probe
        ? ["-v", "error", "-of", "json", ...probe, target]
        : ["-y", "-v", "error", "-i", target, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      const read = (path: string) => volume.readFileSync(path) as Buffer;
      const sync = probe ? evalSyncFfprobe(pipe ? input : undefined, args, read)
        : evalSyncFfmpeg(pipe ? input : undefined, args, read,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      if (pipe) {
        assert.equal(sync, undefined);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else assert.notEqual(sync, undefined);
      volume.writeFileSync("/out.raw", "KEEP");
      let stderr = "", stdout = "";
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return read(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (pipe) for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7); })(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (pipe) {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /found no 'fmt ' tag before the 'data' tag/);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        if (probe) {
          const output = JSON.parse(stdout);
          if (output.packets) assert.equal(Number(output.packets[0].size), 6);
          if (output.streams) assert.equal(output.streams[0].codec_name, "pcm_s16le");
        } else assert.deepEqual(read("/out.raw"), input.subarray(60));
      }
    });
  }
}
