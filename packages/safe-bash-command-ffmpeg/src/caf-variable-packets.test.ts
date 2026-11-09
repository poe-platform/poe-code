import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, frames, packets] of [
  ["varyboth", 8, [{ pts: 0, duration: 2, size: "4" }, { pts: 2, duration: 1, size: "2" }, { pts: 3, duration: 5, size: "10" }]],
  ["widevar", 68, [{ pts: 0, duration: 64, size: "128" }, { pts: 64, duration: 4, size: "8" }]],
  ["no-var-table", 0, []]
] as const) {
  for (const mode of ["decode", "copy", "probe"] as const) {
    for (const sync of mode === "probe" ? [false] : [false, true]) {
      it(`handles ${name} CAF packet tables for ${mode} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.caf", readFileSync(new URL(`../../mp4-ast/src/fixtures/${name}.caf`, import.meta.url)));
        const args = mode === "probe"
          ? ["-v", "error", "-show_packets", "-show_entries", "packet=pts,duration,size:stream=sample_rate,duration_ts,nb_frames", "-of", "json", "/in.caf"]
          : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", mode === "copy" ? "copy" : "pcm_s16le", "-f", mode === "copy" ? "s16be" : "s16le", "/out.raw"];
        let stdout = "", stderr = "";
        if (sync) {
          const run = () => evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          if (frames) assert.equal(run(), "");
          else assert.equal(run(), undefined);
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
          assert.equal(result.exitCode, frames ? 0 : 1, stderr);
          if (!frames) assert.match(stderr, /packet table/);
        }
        if (!frames) {
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else if (mode === "probe") {
          const result = JSON.parse(stdout);
          assert.deepEqual(result.packets, packets);
          assert.deepEqual(result.streams, [{ sample_rate: "8000", duration_ts: frames, nb_frames: String(frames) }]);
        } else {
          const expected = Buffer.alloc(frames * 2);
          for (let i = 0; i < frames; i++) {
            const value = name === "varyboth" ? i + 101 : i;
            if (mode === "copy") expected.writeInt16BE(value, i * 2);
            else expected.writeInt16LE(value, i * 2);
          }
          assert.deepEqual(volume.readFileSync("/out.raw"), expected);
        }
      });
    }
  }
}
