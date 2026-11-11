import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function cueWav(titles: string[]): Buffer {
  const chunk = (name: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(name); header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
  };
  const cues = Buffer.alloc(52);
  cues.writeUInt32LE(2);
  [0, 2000].forEach((start, index) => {
    const offset = 4 + index * 24;
    cues.writeUInt32LE(index + 1, offset);
    cues.writeUInt32LE(start, offset + 4);
    cues.write("data", offset + 8);
    cues.writeUInt32LE(start, offset + 20);
  });
  const labels = titles.map((title, index) => {
    const id = Buffer.alloc(4); id.writeUInt32LE(index + 1);
    return chunk("labl", Buffer.concat([id, Buffer.from(`${title}\0`)]));
  });
  const bytes = Buffer.concat([
    encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] }),
    chunk("cue ", cues), chunk("LIST", Buffer.concat([Buffer.from("adtl"), ...labels]))
  ]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

for (const titles of [["Intro", "Demo"], [], ["", "ok"]]) {
  for (const sync of [false, true]) {
    for (const output of ["chapters", "disabled", "wav"]) {
      it(`imports WAV cues for ${output} output with ${JSON.stringify(titles)} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": cueWav(titles) });
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
        } else {
          // Preserve native FFmpeg's 1/8000 sample intervals.
          assert.equal(bytes.toString(), output === "disabled" ? ";FFMETADATA1\n" :
            `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/8000\nSTART=0\nEND=2000\n${titles[0] === undefined ? "" : `title=${titles[0]}\n`}[CHAPTER]\nTIMEBASE=1/8000\nSTART=2000\nEND=8000\n${titles[1] === undefined ? "" : `title=${titles[1]}\n`}`);
        }
      });
    }
  }
}
