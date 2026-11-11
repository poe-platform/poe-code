import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { parseFfmetadata, parseWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function cueWav(points: readonly (readonly [number, number])[]): Buffer {
  const chunk = (name: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(name); header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
  };
  const cues = Buffer.alloc(4 + points.length * 24);
  cues.writeUInt32LE(points.length);
  points.forEach(([id, start], index) => {
    const offset = 4 + index * 24;
    cues.writeUInt32LE(id, offset);
    cues.writeUInt32LE(start, offset + 4);
    cues.write("data", offset + 8);
    cues.writeUInt32LE(start, offset + 20);
  });
  const labels = ["Intro", "Demo"].map((title, index) => {
    const id = Buffer.alloc(4); id.writeUInt32LE(index + 1);
    return chunk("labl", Buffer.concat([id, Buffer.from(`${title}\0`)]));
  });
  const bytes = Buffer.concat([
    encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] }),
    chunk("cue ", cues), chunk("LIST", Buffer.concat([Buffer.from("adtl"), ...labels]))
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

for (const [name, intervals] of [
  ["ordered", [[1, 0, 400], [2, 400, 800]]],
  ["reverse", [[2, 400, 800], [1, 0, 400]]],
  ["same start", [[1, 400, 800], [2, 400, 800]]],
  ["past end", [[1, 400, 800], [2, 1200, 1200]]]
] as const) {
  for (const sync of [false, true]) {
    for (const output of ["chapters", "disabled", "wav"]) {
      it(`imports ${name} WAV cues for ${output} output (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": cueWav(intervals.map(([id, start]) => [id, start])) });
        const path = output === "wav" ? "/out.wav" : "/out.ffmeta";
        const args = ["-y", "-v", "error", "-i", "/in.wav", "-bitexact",
          ...(output === "disabled" ? ["-map_chapters", "-1"] : []),
          ...(output === "wav" ? ["-c", "copy"] : ["-f", "ffmetadata"]), path];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const bytes = volume.readFileSync(path) as Buffer;
        if (output === "wav") {
          assert.equal(parseWav(bytes).chapters?.length ?? 0, 0);
        } else if (output === "disabled") {
          assert.equal(bytes.toString(), ";FFMETADATA1\n");
        } else {
          assert.deepEqual(parseFfmetadata(bytes).chapters?.map(chapter => ({
            start: chapter.startTimeSeconds, end: chapter.endTimeSeconds, title: chapter.title
          })), intervals.map(([id, start, end]) => ({
            start: start / 8000, end: end / 8000, title: id === 1 ? "Intro" : "Demo"
          })));
        }
      });
    }
  }
}
