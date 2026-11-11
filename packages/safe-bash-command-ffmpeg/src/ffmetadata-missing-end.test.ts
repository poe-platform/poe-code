import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [end, next, expected] of [
    ["", "", 100],
    ["", "[CHAPTER]\nTIMEBASE=1/1000\nSTART=300\nEND=600\ntitle=Next\n", 300],
    ["END=200\n", "", 200]
  ] as const) {
    it(`recovers omitted FFmetadata chapter ends (${sync ? "sync" : "async"}, end=${end}, next=${!!next})`, async () => {
      const chapter = "[CHAPTER]\nTIMEBASE=1/1000\nSTART=100\n";
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] })),
        "/in.ffmeta": `;FFMETADATA1\n${chapter}${end}${end ? "title=Intro\n" : ""}${next}`,
        "/out.ffmeta": "keep"
      });
      const args = ["-y", "-bitexact", "-v", "error", "-i", "/in.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
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
      assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), `;FFMETADATA1\n${chapter}END=${expected}\n${end ? "title=Intro\n" : ""}${next}`);
    });
  }
}
