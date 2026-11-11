import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [body, expected] of [
    ["START=100\nEND=500\ntitle=Intro", "START=100\nEND=500\ntitle=Intro"],
    ["START=100\nEND=500\nEND=300", "START=100\nEND=500\nEND=300"],
    ["END=500\nSTART=100", "START=0\nEND=500\nSTART=100"],
    ["title=early\nSTART=100\nEND=500", "START=0\nEND=0\nSTART=100\nEND=500"],
    ["start=100\nend=500", "START=0\nEND=0\nend=500"]
  ] as const) {
  it(`preserves positional FFmetadata headers (${sync ? "sync" : "async"}, ${body})`, async () => {
    const chapter = "[CHAPTER]\nTIMEBASE=1/1000\n";
    const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] })),
        "/in.ffmeta": `;FFMETADATA1\n${chapter}${body}\n`,
        "/out.ffmeta": "keep"
      });
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-f", "ffmetadata", "-i", "/in.ffmeta",
        "-map_metadata", "1", "-map_chapters", "1", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        const missingStart = !body.startsWith("START=");
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), missingStart ? undefined : "");
        if (missingStart) {
          // Recoverable diagnostics require the asynchronous execution path.
          assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), "keep");
          return;
        }
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
      assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), `;FFMETADATA1\n${chapter}${expected}\n`);
    });

}
}
