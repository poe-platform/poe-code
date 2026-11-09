import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact legacy VOC fixtures verified against native FFmpeg and ffprobe.
for (const fixture of [
  { name: "single", channels: 1, pcm: "004080ff",
    hex: "437265617469766520566f6963652046696c651a1a0014011f11010600008300004080ff00",
    packets: [{"pts": 0, "duration": 4, "size": "4", "pos": "32"}] },
  { name: "continued", channels: 1, pcm: "004080ff0dc55a",
    hex: "437265617469766520566f6963652046696c651a1a0014011f11010600008300004080ff020300000dc55a00",
    packets: [{"pts": 0, "duration": 4, "size": "4", "pos": "32"}, {"pts": 4, "duration": 3, "size": "3", "pos": "40"}] },
  { name: "paused", channels: 1, pcm: "004080ff0dc55a",
    hex: "437265617469766520566f6963652046696c651a1a0014011f11010600008300004080ff030300000f0083020300000dc55a00",
    packets: [{"pts": 0, "duration": 4, "size": "4", "pos": "32"}, {"pts": 4, "duration": 3, "size": "3", "pos": "47"}] },
  { name: "annotated", channels: 1, pcm: "004080ff0dc55a",
    hex: "437265617469766520566f6963652046696c651a1a0014011f11010600008300004080ff050500004e6f746500040200001400020300000dc55a00",
    packets: [{"pts": 0, "duration": 4, "size": "4", "pos": "32"}, {"pts": 4, "duration": 3, "size": "3", "pos": "55"}] },
  { name: "stereo", channels: 2, pcm: "02fa0df03287439a",
    hex: "437265617469766520566f6963652046696c651a1a0014011f110804000080c10001010a0000830002fa0df03287439a00",
    packets: [{"pts": 0, "duration": 4, "size": "8", "pos": "40"}] },
]) {
  const input = Buffer.from(fixture.hex, "hex");

  for (const mode of ["decode", "copy", "probe"] as const) {
    for (const sync of mode === "probe" ? [false] : [false, true]) {
      it(`accepts ${fixture.name} legacy VOC for ${mode} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.voc", input);
        const args = mode === "probe"
          ? ["-v", "error", "-show_packets", "-show_entries", "format=format_name:packet=pts,pos,size,duration:stream=codec_name,sample_rate,channels,time_base", "-of", "json", "/in.voc"]
          : ["-v", "error", "-y", "-i", "/in.voc", "-c:a", mode === "copy" ? "copy" : "pcm_u8", "-f", "u8", "/out.raw"];
        let stdout = "", stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          const result = await (mode === "probe" ? createFfprobeCommand() : createFfmpegCommand()).execute({
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
        }
        if (mode === "probe") {
          const result = JSON.parse(stdout);
          assert.deepEqual(result.format, { format_name: "voc" });
          assert.deepEqual(result.packets, fixture.packets);
          assert.deepEqual(result.streams, [{ codec_name: "pcm_u8", sample_rate: "8000", channels: fixture.channels, time_base: "1/8000" }]);
        } else {
          assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(fixture.pcm, "hex"));
        }
      });
    }
  }
}
