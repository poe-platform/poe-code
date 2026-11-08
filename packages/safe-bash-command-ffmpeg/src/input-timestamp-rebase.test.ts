import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(args: string[], sync: boolean, files: Record<string, Buffer>) {
  const volume = Volume.fromJSON(files);
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, data) => { volume.writeFileSync(path, data); return true; }) : await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { volume, success: sync ? result === "" : (result as { exitCode: number }).exitCode === 0, stderr };
}

for (const sync of [false, true]) {
  for (const [name, inputs, starts] of [
    ["base", ["-i", "/base.mp4"], [0, -0.064]],
    ["shifted", ["-i", "/shifted.mp4"], [0.064, 0]],
    ["offset", ["-itsoffset", "0.25", "-i", "/shifted.mp4"], [0.314, 0.25]],
    ["mixed", ["-i", "/base.mp4", "-i", "/shifted.mp4", "-map", "0:v", "-map", "1:a"], [0, 0]],
    ["delayed", ["-i", "/delayed.mp4"], [0, 0.436]],
  ] as const) {
    if (sync && name === "mixed") continue; // Stream mapping falls back to async execution.
    it(`${sync ? "sync" : "async"} rebases ${name} MP4 input while preserving relative packet timing`, async () => {
      const files = Object.fromEntries(["base", "shifted", "delayed"].map(name => [
        `/${name}.mp4`, readFileSync(new URL(`./fixtures/timestamp-rebase/${name}.mp4`, import.meta.url))
      ]));
      const result = await run(["-y", ...inputs, "-c", "copy", "/out.mp4"], sync, files);
      assert.ok(result.success, result.stderr);
      const doc = parseMp4(result.volume.readFileSync("/out.mp4") as Buffer);
      assert.deepEqual(doc.tracks.map(track => track.samples.length), [5, 17]);
      doc.tracks.forEach((track, index) => {
        const sourceName = name === "mixed" ? (index === 0 ? "base" : "shifted") : name === "offset" ? "shifted" : name;
        const source = parseMp4(files[`/${sourceName}.mp4`]!);
        assert.deepEqual(track.samples.map(sample => sample.data), source.tracks[index]!.samples.map(sample => sample.data));
        let offset = 0;
        for (const edit of track.editList ?? []) {
          if (edit.mediaTime < 0) offset += edit.segmentDuration / doc.timescale;
          else { offset -= edit.mediaTime / track.timescale; break; }
        }
        const times = track.samples.map(sample => sample.pts / track.timescale + offset);
        assert.ok(Math.abs(times[0]! - starts[index]!) < 0.0001, `${track.type}: ${times[0]} != ${starts[index]}`);
        assert.ok(Math.abs(times.at(-1)! - (starts[index]! + (index === 0 ? 0.8 : 1.024))) < 0.0001);
      });
    });
  }
}
