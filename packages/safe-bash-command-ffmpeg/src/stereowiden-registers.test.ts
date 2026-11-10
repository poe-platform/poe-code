import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [new Float64Array(48), new Float64Array(48)];
for (let i = 0; i < 48; i++) {
  channels[0]![i] = (i % 8 === 0 ? 10000 : 100) / 32768;
  channels[1]![i] = (i % 8 === 4 ? -8000 : -200) / 32768;
}

// FFmpeg 7.0.2 evaluates the timeline twice per frame. Both expressions
// enable the first two eight-sample frames and produce the same full PCM.
for (const filters of [
  "stereowiden=delay=1:enable='st(0,ld(0)+1);lte(ld(0),4)'",
  "stereowiden=delay=1:enable='lt(n,2)'",
  "asendcmd=c='0 stereowiden enable lte(st(0,ld(0)+1),4)',stereowiden=delay=1:enable=0",
  "asendcmd=c='0.001 stereowiden enable lte(st(0,ld(0)+1),2)',stereowiden=delay=1:enable='lte(st(0,ld(0)+1),2)'",
  "asendcmd=c='0.001 stereowiden enable st(0,99)+invalid',stereowiden=delay=1:enable='lte(st(0,ld(0)+1),4)'"
]) {
  for (const complex of [false, true]) {
    it(`preserves stereowiden timeline registers: ${filters} (${complex ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
      const filter = `asetnsamples=n=8:p=0,${filters}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 192);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "24b16f7379b1c0cd03c28e5bbcd5f554a2eb4f93b3094a08b7f4ab03a7c28953");
    });
  }
}
