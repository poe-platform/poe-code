import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const date of [undefined, "2005"]) {
  for (const sync of [false, true]) {
    it(`preserves FFmetadata year with date=${date} (${sync ? "sync" : "async"})`, async () => {
      const input = `;FFMETADATA1\nyear=1988\n${date === undefined ? "" : `date=${date}\n`}`;
      const volume = Volume.fromJSON({
        "/in.ffmeta": input, "/out.ffmeta": "keep",
        "/audio.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }))
      });
      const args = ["-y", "-v", "error", "-i", "/audio.wav", "-f", "ffmetadata", "-i", "/in.ffmeta", "-map_metadata", "1", "-map_chapters", "1", "-f", "ffmetadata", "/out.ffmeta"];
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
      assert.deepEqual(output.trim().split("\n").slice(1).filter(line => !line.startsWith("encoder=")).sort(),
        ["year=1988", ...(date === undefined ? [] : [`date=${date}`])].sort());
    });
  }
}
