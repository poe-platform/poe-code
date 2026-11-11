import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Extensible PCM16 WAV, 8 kHz, FL/FR/BL/BR; native FFmpeg emits 2328 and -2328.
const header = Buffer.from("524946464c00000057415645666d742028000000feff0400401f000000fa00000800100016001000330000000100000000001000800000aa00389b716461746110000000", "hex");
const samples = Buffer.from("e803d007b80ba00f18fc30f848f460f0", "hex");

for (const wav of [false, true]) {
  for (const graph of [false, true]) {
    for (const [split, expected, disabled] of [["mono:FC", "1809e8f6", false], ["stereo:FL", "2407dcf8", false], ["mono:FC", "", true]] as const) {
      it(`downmixes quad ${wav ? "WAV" : "raw"} before channelsplit=${split} (${graph ? "graph" : "simple"}, conversion ${disabled ? "disabled" : "enabled"})`, async () => {
        const volume = new Volume();
        const path = wav ? "/in.wav" : "/in.raw";
        volume.writeFileSync(path, wav ? Buffer.concat([header, samples]) : samples);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(disabled ? ["-noauto_conversion_filters"] : []), ...(wav ? [] : ["-f", "s16le", "-ar", "8000", "-ac", "4", "-channel_layout", "quad"]),
            "-i", path, ...(graph
              ? ["-filter_complex", `[0:a]channelsplit=${split}[out]`, "-map", "[out]"]
              : ["-af", `channelsplit=${split}`]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (disabled) {
          assert.equal(result.exitCode, 234, stderr);
          assert.match(stderr, /automatic conversion is disabled/);
          assert.equal(volume.existsSync("/out.raw"), false);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      });
    }
  }
}
