import { parseFfmetadata } from "@poe-code/mp4-ast";
import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [start, end] of [[-100, 500], [-500, -100], [100, 500], [-100, 0]] as const) {
    it(`clips FFmetadata chapter ${start}..${end} against zero (${sync ? "sync" : "async"})`, async () => {
      const body = `START=${start}\nEND=${end}\ntitle=Intro`;
      const chapter = "[CHAPTER]\nTIMEBASE=1/1000\n";
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] })),
        "/in.ffmeta": `;FFMETADATA1\n${chapter}${body}\n`,
        "/out.ffmeta": "keep"
      });
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
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
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      const doc = parseFfmetadata(new TextEncoder().encode(output));
      assert.equal(doc.chapters?.length ?? 0, end < 0 ? 0 : 1);
      assert.equal(output, end < 0 ? ";FFMETADATA1\n" :
        `;FFMETADATA1\n${chapter}START=${Math.max(0, start)}\nEND=${end}\ntitle=Intro\n`);
      if (end >= 0) {
        assert.equal(doc.chapters?.[0]?.startTimeSeconds, Math.max(0, start) / 1000);
        assert.equal(doc.chapters?.[0]?.endTimeSeconds, end / 1000);
      }
    });
  }
}
