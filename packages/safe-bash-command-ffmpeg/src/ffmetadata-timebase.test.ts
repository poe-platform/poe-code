import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const denominator of [0, -1000, 1000]) {
    it(`handles chapter time base 1/${denominator} without overwriting output on failure (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({
        "/audio.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] })),
        "/in.ffmeta": `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/${denominator}\nSTART=100\nEND=500\ntitle=Chapter\n`,
        "/out.ffmeta": "keep"
      });
      const args = ["-v", "error", "-y", "-i", "/audio.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, denominator <= 0 ? undefined : "");
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
        assert.equal(result.exitCode, denominator <= 0 ? 1 : 0, stderr);
        if (denominator <= 0) assert.ok(stderr.includes("FFmetadata chapter TIMEBASE denominator must be positive"), stderr);
      }
      const output = volume.readFileSync("/out.ffmeta", "utf8") as string;
      if (denominator <= 0) assert.equal(output, "keep");
      else assert.ok(output.includes(`TIMEBASE=1/1000\nSTART=100\nEND=500\n`), output);
    });
  }
}
